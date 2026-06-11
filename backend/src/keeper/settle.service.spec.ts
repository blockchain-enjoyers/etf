import { describe, expect, it, vi } from "vitest";
import type { ChainService } from "../chain/chain.service.js";
import type { ConfigService } from "../config/config.service.js";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import type { SettleWriterPort } from "../capabilities/settle-writer.port.js";
import type { PrismaService } from "../persistence/prisma.service.js";
import { SettleService } from "./settle.service.js";

type FakeEntry = {
  id: string;
  vaultAddress: string;
  owner?: string;
  nonce: bigint;
  status: string;
  settledTxHash?: string;
};

function fakeWallet() {
  return {
    account: { address: "0xKEEPER" as `0x${string}` },
    writeContract: vi.fn(async () => "0xtx" as `0x${string}`),
  };
}

function fakeChain(wallet: ReturnType<typeof fakeWallet>) {
  return {
    walletClient: wallet,
    account: wallet.account,
    chain: { id: 46630 },
  } as unknown as ChainService;
}

function nullWriter(): SettleWriterPort {
  return {
    settle: vi.fn(async () => {
      throw new CapabilityUnavailableError("RebalanceModule");
    }),
  } as unknown as SettleWriterPort;
}

function liveWriter(txHash = "0xtx"): SettleWriterPort {
  return { settle: vi.fn(async () => txHash as `0x${string}`) } as unknown as SettleWriterPort;
}

function fakeConfig(enabled = true) {
  return {
    get: (k: string) => (k === "KEEPER_ENABLED" ? enabled : undefined),
  } as unknown as ConfigService;
}

function fakePrisma(entries: FakeEntry[]) {
  return {
    entries,
    queueEntry: {
      findMany: vi.fn(
        async ({ where }: { where: { vaultAddress: string; status: string } }) =>
          entries.filter((e) => e.vaultAddress === where.vaultAddress && e.status === where.status),
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = entries.find((e) => e.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        },
      ),
    },
    basket: { findUnique: vi.fn(async () => ({ vaultAddress: "0xvault" })) },
  } as unknown as PrismaService & { entries: FakeEntry[] };
}

describe("SettleService", () => {
  it("is dormant at L1: null writer → all pending entries flip to Failed, no settle", async () => {
    const prisma = fakePrisma([
      { id: "q1", vaultAddress: "0xbeef", owner: "0xa", nonce: 1n, status: "Pending" },
    ]);
    const svc = new SettleService(fakeChain(fakeWallet()), nullWriter(), prisma, fakeConfig(true));
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("noop");
    expect(res.detail).toContain("RebalanceModule");
    expect(prisma.entries[0]!.status).toBe("Pending");
  });

  it("settles each pending entry through the writer and marks it Settled", async () => {
    const writer = liveWriter("0xtx");
    const prisma = fakePrisma([
      { id: "q1", vaultAddress: "0xbeef", owner: "0xa", nonce: 1n, status: "Pending" },
      { id: "q2", vaultAddress: "0xbeef", owner: "0xb", nonce: 2n, status: "Pending" },
    ]);
    const svc = new SettleService(fakeChain(fakeWallet()), writer, prisma, fakeConfig(true));
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("submitted");
    expect(writer.settle).toHaveBeenCalledTimes(2);
    expect(prisma.entries.every((e) => e.status === "Settled")).toBe(true);
    expect(prisma.entries[0]!.settledTxHash).toBe("0xtx");
  });

  it("skips when there are no pending entries", async () => {
    const prisma = fakePrisma([
      { id: "q1", vaultAddress: "0xbeef", nonce: 1n, status: "Settled" },
    ]);
    const svc = new SettleService(fakeChain(fakeWallet()), liveWriter(), prisma, fakeConfig(true));
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("skipped");
  });

  it("no-ops when keeper disabled", async () => {
    const prisma = fakePrisma([
      { id: "q1", vaultAddress: "0xbeef", nonce: 1n, status: "Pending" },
    ]);
    const svc = new SettleService(fakeChain(fakeWallet()), liveWriter(), prisma, fakeConfig(false));
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("noop");
  });
});
