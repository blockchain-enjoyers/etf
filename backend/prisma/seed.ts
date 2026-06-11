import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

const VAULT = "0x5eed000000000000000000000000000000000001";
const T1 = "0x5eed000000000000000000000000000000000010";
const T2 = "0x5eed000000000000000000000000000000000020";
const T3 = "0x5eed000000000000000000000000000000000030";

const tokens = [
  { address: T1, symbol: "TSLA", name: "Tesla Inc.", decimals: 18 },
  { address: T2, symbol: "AMZN", name: "Amazon.com Inc.", decimals: 18 },
  { address: T3, symbol: "PLTR", name: "Palantir Technologies Inc.", decimals: 18 },
];

const UNIT_QTY = "1000000000000000000";

// Prices in 18-dec USD: TSLA $250, AMZN $180, PLTR $30
const tokenPrices: Record<string, bigint> = {
  [T1]: 250n * 10n ** 18n,
  [T2]: 180n * 10n ** 18n,
  [T3]: 30n * 10n ** 18n,
};

// Base NAV per unit = sum of prices = $460
const BASE_NAV = 460n * 10n ** 18n;
const NAV_POINTS = 30;

async function main(): Promise<void> {
  // TokenMetadata
  for (const t of tokens) {
    await prisma.tokenMetadata.upsert({
      where: { token: t.address.toLowerCase() },
      create: { token: t.address.toLowerCase(), symbol: t.symbol, name: t.name, decimals: t.decimals },
      update: { symbol: t.symbol, name: t.name, decimals: t.decimals },
    });
  }

  // Basket
  await prisma.basket.upsert({
    where: { vaultAddress: VAULT },
    create: {
      vaultAddress: VAULT,
      name: "Demo Index",
      symbol: "mDEMO",
      vaultType: "Basket",
      unitSize: "1000000000000000000",
      frozen: false,
      basketToken: null,
      cashToken: null,
      manager: null,
    },
    update: {
      name: "Demo Index",
      symbol: "mDEMO",
      vaultType: "Basket",
      unitSize: "1000000000000000000",
      frozen: false,
    },
  });

  // Constituents
  for (const t of tokens) {
    await prisma.constituent.upsert({
      where: { vaultAddress_token: { vaultAddress: VAULT, token: t.address } },
      create: { vaultAddress: VAULT, token: t.address, unitQty: UNIT_QTY },
      update: { unitQty: UNIT_QTY },
    });
  }

  // PriceSnapshots — delete old seed rows then insert fresh
  await prisma.priceSnapshot.deleteMany({
    where: { token: { in: tokens.map((t) => t.address) } },
  });
  const now = new Date();
  for (const t of tokens) {
    await prisma.priceSnapshot.create({
      data: {
        token: t.address,
        price: tokenPrices[t.address]!.toString(),
        confidence: "0",
        marketStatus: "Regular",
        source: "Chainlink",
        timestamp: now,
      },
    });
  }

  // NavSnapshot series — delete old seed rows then insert fresh 30-point history
  await prisma.navSnapshot.deleteMany({ where: { vaultAddress: VAULT } });
  const MS_PER_HOUR = 3_600_000;
  for (let i = 0; i < NAV_POINTS; i++) {
    // slight sine variation ±1%
    const factor = 1 + 0.01 * Math.sin(i / 3);
    const nav = BigInt(Math.round(Number(BASE_NAV) * factor));
    const lower = (nav * 99n) / 100n;
    const upper = (nav * 101n) / 100n;
    const timestamp = new Date(now.getTime() - (NAV_POINTS - 1 - i) * MS_PER_HOUR);
    await prisma.navSnapshot.create({
      data: {
        vaultAddress: VAULT,
        nav: nav.toString(),
        confidenceLower: lower.toString(),
        confidenceUpper: upper.toString(),
        marketStatus: "Regular",
        source: "Chainlink",
        estimated: false,
        severity: null,
        safe: true,
        timestamp,
      },
    });
  }

  console.log("Seed complete: demo basket, 3 constituents, 3 price snapshots, 30 nav snapshots.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
