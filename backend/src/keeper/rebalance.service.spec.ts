import { describe, expect, it, vi } from "vitest";
import type { ChainService } from "../chain/chain.service.js";
import type { ConfigService } from "../config/config.service.js";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import type { RebalanceWriterPort } from "../capabilities/rebalance-writer.port.js";
import type { BasketRepository } from "../persistence/basket.repository.js";
import { RebalanceService } from "./rebalance.service.js";

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

function nullWriter(): RebalanceWriterPort {
  return {
    triggerRebalance: vi.fn(async () => {
      throw new CapabilityUnavailableError("RebalanceModule");
    }),
  } as unknown as RebalanceWriterPort;
}

function liveWriter(txHash = "0xtx"): RebalanceWriterPort {
  return {
    triggerRebalance: vi.fn(async () => txHash as `0x${string}`),
  } as unknown as RebalanceWriterPort;
}

function fakeBasketRepo(vaultAddress = "0xvault") {
  return {
    findReference: vi.fn(async () => ({ vaultAddress, referenceToken: "0xref" })),
  } as unknown as BasketRepository;
}

function fakeConfig(enabled = true) {
  return {
    get: (k: string) => (k === "KEEPER_ENABLED" ? enabled : undefined),
  } as unknown as ConfigService;
}

describe("RebalanceService", () => {
  it("is dormant at L1: null writer → noop (capability absent)", async () => {
    const svc = new RebalanceService(
      fakeChain(fakeWallet()),
      nullWriter(),
      fakeBasketRepo(),
      fakeConfig(true),
    );
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("noop");
    expect(res.detail).toContain("RebalanceModule");
  });

  it("triggers rebalance through the writer when live", async () => {
    const writer = liveWriter("0xtx");
    const svc = new RebalanceService(
      fakeChain(fakeWallet()),
      writer,
      fakeBasketRepo("0xvault"),
      fakeConfig(true),
    );
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("submitted");
    expect(res.txHash).toBe("0xtx");
    expect(writer.triggerRebalance).toHaveBeenCalledWith("0xvault");
  });

  it("no-ops when keeper disabled", async () => {
    const svc = new RebalanceService(
      fakeChain(fakeWallet()),
      liveWriter(),
      fakeBasketRepo(),
      fakeConfig(false),
    );
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("noop");
  });

  it("no-ops when walletClient is absent", async () => {
    const writer = liveWriter();
    const svc = new RebalanceService(
      fakeChain(null),
      writer,
      fakeBasketRepo(),
      fakeConfig(true),
    );
    const res = await svc.run({ vaultAddress: "0xbeef" });
    expect(res.status).toBe("noop");
    expect(writer.triggerRebalance).not.toHaveBeenCalled();
  });
});
