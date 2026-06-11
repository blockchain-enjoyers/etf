import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FairValueService } from "./fair-value.service.js";
import { FAIR_VALUE_EIP712_TYPES, fairValueDomain } from "./fair-value.types.js";

// Throwaway test key (NOT a real secret) — used only to produce a valid signature in-test.
const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(TEST_PK);
const OTHER = "0x000000000000000000000000000000000000dEaD" as const;
const VERIFYING = "0x00000000000000000000000000000000000000aa" as const;
// bytes32-padded basket ID (EIP-712 bytes32 requires exactly 32 bytes)
const BASKET_ID = "0xbeef000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

type FakeRow = Record<string, unknown> & { id: string };

function fakePrisma() {
  const rows: FakeRow[] = [];
  return {
    rows,
    fairValueAttestation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Prisma returns Decimal columns (toFixed/toString); the service reads row.nav.toFixed(0).
        const dec = (v: unknown) => ({ toFixed: () => String(v), toString: () => String(v) });
        const row: FakeRow = { id: `fv${rows.length}`, ...data, nav: dec(data.nav), lower: dec(data.lower), upper: dec(data.upper) };
        rows.push(row);
        return row;
      }),
      findFirst: vi.fn(async () => rows[rows.length - 1] ?? null),
    },
  };
}

function fakeConfig(over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    CHAIN_ID: 46630,
    FAIRVALUE_SIGNER_ADDRESS: account.address,
    FAIRVALUE_VERIFYING_CONTRACT: VERIFYING,
    FAIRVALUE_MAX_AGE_SECONDS: 86_400,
    ...over,
  };
  return { get: (k: string) => values[k] } as unknown as import("../config/config.service.js").ConfigService;
}

async function sign(value: {
  basketId: `0x${string}`;
  nav: bigint;
  lower: bigint;
  upper: bigint;
  timestamp: number;
}) {
  return account.signTypedData({
    domain: fairValueDomain(46630, VERIFYING),
    types: FAIR_VALUE_EIP712_TYPES,
    primaryType: "FairValue",
    message: {
      basketId: value.basketId,
      nav: value.nav,
      lower: value.lower,
      upper: value.upper,
      timestamp: BigInt(value.timestamp),
    },
  });
}

const now = 1_700_000_000;

describe("FairValueService", () => {
  beforeEach(() => vi.useRealTimers());

  function make(over: Record<string, unknown> = {}) {
    const prisma = fakePrisma();
    const svc = new FairValueService(
      prisma as unknown as import("../persistence/prisma.service.js").PrismaService,
      fakeConfig(over),
    );
    vi.spyOn(svc as unknown as { nowSeconds(): number }, "nowSeconds").mockReturnValue(now);
    return { prisma, svc };
  }

  const base = {
    basketId: BASKET_ID,
    nav: 1_000000000000000000n,
    lower: 990000000000000000n,
    upper: 1_010000000000000000n,
    timestamp: now,
  };

  it("accepts a correctly-signed, fresh, well-formed attestation and persists it", async () => {
    const { prisma, svc } = make();
    const signature = await sign(base);
    const res = await svc.ingest({ ...base, signer: account.address, signature });
    expect(res.id).toBeDefined();
    expect(prisma.fairValueAttestation.create).toHaveBeenCalledOnce();
    expect((prisma.rows[0]!.signer as string).toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("rejects when the recovered signer is not the configured signer", async () => {
    const { svc } = make({ FAIRVALUE_SIGNER_ADDRESS: OTHER });
    const signature = await sign(base);
    await expect(
      svc.ingest({ ...base, signer: account.address, signature }),
    ).rejects.toThrow(/signer/i);
  });

  it("rejects a stale attestation beyond max age", async () => {
    const { svc } = make({ FAIRVALUE_MAX_AGE_SECONDS: 60 });
    const stale = { ...base, timestamp: now - 600 };
    const signature = await sign(stale);
    await expect(
      svc.ingest({ ...stale, signer: account.address, signature }),
    ).rejects.toThrow(/stale/i);
  });

  it("rejects a malformed band (lower > nav or nav > upper)", async () => {
    const { svc } = make();
    const bad = { ...base, lower: 2_000000000000000000n };
    const signature = await sign(bad);
    await expect(
      svc.ingest({ ...bad, signer: account.address, signature }),
    ).rejects.toThrow(/band/i);
  });

  it("latestForBasket returns an estimated, Closed, LastClose NavResult", async () => {
    const { svc } = make();
    const signature = await sign(base);
    await svc.ingest({ ...base, signer: account.address, signature });
    const r = await svc.latestForBasket(BASKET_ID);
    expect(r).not.toBeNull();
    expect(r!.estimated).toBe(true);
    expect(r!.marketStatus).toBe("Closed");
    expect(r!.source).toBe("LastClose");
    expect(r!.nav).toBe(base.nav);
    expect(r!.confidenceLower).toBe(base.lower);
    expect(r!.confidenceUpper).toBe(base.upper);
  });
});
