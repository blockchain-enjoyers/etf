import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainService } from "../chain/chain.service.js";
import type { ConfigService } from "../config/config.service.js";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import type { FairValueSinkPort } from "../capabilities/fair-value-sink.port.js";
import type { PrismaService } from "../persistence/prisma.service.js";
import { AttestationService } from "./attestation.service.js";

type FakeAtt = {
  id: string;
  vaultAddress: string;
  nav: { toString(): string };
  lower: { toString(): string };
  upper: { toString(): string };
  timestamp: Date;
  signature: string;
  pushedTxHash: string | null;
};

function fakePrisma(att: FakeAtt) {
  return {
    fairValueAttestation: {
      findUnique: vi.fn(async () => att),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...att, ...data })),
    },
  };
}

function fakeWallet() {
  return {
    account: { address: "0xKEEPER" as `0x${string}` },
    writeContract: vi.fn(async () => "0xtx" as `0x${string}`),
  };
}

function fakeChain(wallet: ReturnType<typeof fakeWallet> | null) {
  return {
    walletClient: wallet,
    account: wallet?.account ?? undefined,
    chain: { id: 46630 },
  } as unknown as ChainService;
}

function nullSink(): FairValueSinkPort {
  return {
    push: vi.fn(async () => {
      throw new CapabilityUnavailableError("FairValueNAV");
    }),
  } as unknown as FairValueSinkPort;
}

function liveSink(txHash = "0xtx"): FairValueSinkPort {
  return { push: vi.fn(async () => txHash as `0x${string}`) } as unknown as FairValueSinkPort;
}

function fakeConfig(enabled = true) {
  return {
    get: (k: string) => (k === "KEEPER_ENABLED" ? enabled : undefined),
  } as unknown as ConfigService;
}

const att: FakeAtt = {
  id: "fv1",
  vaultAddress: "0xbeef",
  nav: { toString: () => "1.000000000000000000" },
  lower: { toString: () => "0.990000000000000000" },
  upper: { toString: () => "1.010000000000000000" },
  timestamp: new Date(1_700_000_000 * 1000),
  signature: "0xsig",
  pushedTxHash: null,
};

describe("AttestationService", () => {
  let wallet: ReturnType<typeof fakeWallet>;
  beforeEach(() => {
    wallet = fakeWallet();
  });

  it("is dormant at L1: null sink → noop (capability absent), no row read", async () => {
    const prisma = fakePrisma({ ...att });
    const svc = new AttestationService(
      fakeChain(wallet),
      nullSink(),
      prisma as unknown as PrismaService,
      fakeConfig(true),
    );
    const res = await svc.push({ vaultAddress: "0xbeef", attestationId: "fv1" });
    expect(res.status).toBe("noop");
    expect(res.detail).toContain("FairValueNAV");
  });

  it("pushes via the sink and records the tx hash when live", async () => {
    const prisma = fakePrisma({ ...att });
    const svc = new AttestationService(
      fakeChain(wallet),
      liveSink("0xtx"),
      prisma as unknown as PrismaService,
      fakeConfig(true),
    );
    const res = await svc.push({ vaultAddress: "0xbeef", attestationId: "fv1" });
    expect(res.status).toBe("submitted");
    expect(res.txHash).toBe("0xtx");
    expect(prisma.fairValueAttestation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pushedTxHash: "0xtx" }) }),
    );
  });

  it("is idempotent: skips when already pushed", async () => {
    const prisma = fakePrisma({ ...att, pushedTxHash: "0xprev" });
    const svc = new AttestationService(
      fakeChain(wallet),
      liveSink(),
      prisma as unknown as PrismaService,
      fakeConfig(true),
    );
    const res = await svc.push({ vaultAddress: "0xbeef", attestationId: "fv1" });
    expect(res.status).toBe("skipped");
  });

  it("no-ops when KEEPER_ENABLED is false", async () => {
    const prisma = fakePrisma({ ...att });
    const svc = new AttestationService(
      fakeChain(wallet),
      liveSink(),
      prisma as unknown as PrismaService,
      fakeConfig(false),
    );
    const res = await svc.push({ vaultAddress: "0xbeef", attestationId: "fv1" });
    expect(res.status).toBe("noop");
  });

  it("degrades gracefully when walletClient is absent (no KEEPER_PRIVATE_KEY)", async () => {
    const prisma = fakePrisma({ ...att });
    const svc = new AttestationService(
      fakeChain(null),
      liveSink(),
      prisma as unknown as PrismaService,
      fakeConfig(true),
    );
    const res = await svc.push({ vaultAddress: "0xbeef", attestationId: "fv1" });
    expect(res.status).toBe("noop");
    expect(prisma.fairValueAttestation.findUnique).not.toHaveBeenCalled();
  });
});
