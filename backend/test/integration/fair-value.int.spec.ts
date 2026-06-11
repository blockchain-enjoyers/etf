import { Test } from "@nestjs/testing";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { FairValueModule } from "../../src/fairvalue/fair-value.module.js";
import { FairValueService } from "../../src/fairvalue/fair-value.service.js";
import { FAIR_VALUE_EIP712_TYPES, fairValueDomain } from "../../src/fairvalue/fair-value.types.js";

const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(TEST_PK);
const VERIFYING = "0x00000000000000000000000000000000000000aa" as const;
const BASKET_ID = "0x000000000000000000000000000000000000000000000000000000000000beef" as const;
const VAULT = BASKET_ID;

describe("FairValueService (integration)", () => {
  let prisma: PrismaService;
  let svc: FairValueService;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    process.env.FAIRVALUE_SIGNER_ADDRESS = account.address;
    process.env.FAIRVALUE_VERIFYING_CONTRACT = VERIFYING;
    process.env.FAIRVALUE_MAX_AGE_SECONDS = "86400";
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule, FairValueModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    svc = moduleRef.get(FairValueService);
    await prisma.onModuleInit();
    await prisma.basket.create({
      data: {
        vaultAddress: VAULT,
        unitSize: "100",
        name: "FV Basket",
        symbol: "mFV",
      },
    });
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
    await moduleRef.close();
  });

  it("persists a signed attestation and reads it back as an estimated NavResult", async () => {
    const now = Math.floor(Date.now() / 1000);
    const message = {
      basketId: BASKET_ID,
      nav: 1_000000000000000000n,
      lower: 990000000000000000n,
      upper: 1_010000000000000000n,
      timestamp: BigInt(now),
    };
    const signature = await account.signTypedData({
      domain: fairValueDomain(46630, VERIFYING),
      types: FAIR_VALUE_EIP712_TYPES,
      primaryType: "FairValue",
      message,
    });

    const { id } = await svc.ingest({
      basketId: VAULT,
      nav: message.nav,
      lower: message.lower,
      upper: message.upper,
      timestamp: now,
      signer: account.address,
      signature,
    });
    expect(id).toBeDefined();

    const stored = await prisma.fairValueAttestation.findUnique({ where: { id } });
    expect(BigInt(stored!.nav.toString())).toBe(message.nav);

    const result = await svc.latestForBasket(VAULT);
    expect(result?.estimated).toBe(true);
    expect(result?.source).toBe("LastClose");
    expect(result?.nav).toBe(message.nav);
  });
});
