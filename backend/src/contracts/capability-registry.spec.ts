import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "./capability-registry.js";

const FACTORY = "0x00000000000000000000000000000000000000f1";
const VAULT = "0x00000000000000000000000000000000000000a2";
const ZERO = "0x0000000000000000000000000000000000000000";

// A ChainService stub exposing only the publicClient.getCode the probe uses.
function chainOf(byAddress: Record<string, `0x${string}` | undefined>) {
  return {
    publicClient: {
      getCode: vi.fn(async ({ address }: { address: `0x${string}` }) => byAddress[address]),
    },
  } as never;
}

describe("CapabilityRegistry (config detection)", () => {
  it("reports a capability absent when the address map is empty", () => {
    const reg = new CapabilityRegistry(46630, {}, chainOf({}));
    expect(reg.present("CloneFactory")).toBe(false);
    expect(reg.status("CloneFactory")).toBe("absent");
    expect(reg.address("CloneFactory")).toBeUndefined();
  });

  it("returns and reports an address present when configured", () => {
    const reg = new CapabilityRegistry(46630, { CloneFactory: FACTORY }, chainOf({}));
    expect(reg.present("CloneFactory")).toBe(true);
    expect(reg.status("CloneFactory")).toBe("live");
    expect(reg.address("CloneFactory")).toBe(FACTORY);
  });

  it("treats the zero address as absent", () => {
    const reg = new CapabilityRegistry(46630, { CloneFactory: ZERO }, chainOf({}));
    expect(reg.present("CloneFactory")).toBe(false);
    expect(reg.status("CloneFactory")).toBe("absent");
  });
});

describe("CapabilityRegistry.probe (boot)", () => {
  it("marks a present capability absent when its address has no bytecode (0x)", async () => {
    const reg = new CapabilityRegistry(
      46630,
      { CloneFactory: FACTORY, BasketVault: VAULT },
      chainOf({ [FACTORY]: "0x60806040", [VAULT]: "0x" }),
    );
    await reg.probe();
    expect(reg.status("CloneFactory")).toBe("live");
    expect(reg.present("BasketVault")).toBe(false);
    expect(reg.status("BasketVault")).toBe("absent");
  });

  it("marks a present capability absent when getCode returns undefined", async () => {
    const reg = new CapabilityRegistry(46630, { FairValueNAV: VAULT }, chainOf({ [VAULT]: undefined }));
    await reg.probe();
    expect(reg.status("FairValueNAV")).toBe("absent");
  });

  it("keeps a capability live when bytecode is present", async () => {
    const reg = new CapabilityRegistry(46630, { CloneFactory: FACTORY }, chainOf({ [FACTORY]: "0x60806040" }));
    await reg.probe();
    expect(reg.status("CloneFactory")).toBe("live");
  });

  it("does not probe absent capabilities (no getCode call)", async () => {
    const chain = chainOf({});
    const reg = new CapabilityRegistry(46630, {}, chain);
    await reg.probe();
    expect((chain as { publicClient: { getCode: ReturnType<typeof vi.fn> } }).publicClient.getCode).not.toHaveBeenCalled();
  });
});

describe("CapabilityRegistry L3 capabilities", () => {
  it("resolves KeeperModule + ManagedRebalanceVault addresses when configured", () => {
    const reg = new CapabilityRegistry(
      46630,
      {
        KeeperModule: "0x1111111111111111111111111111111111111111",
        ManagedRebalanceVault: "0x2222222222222222222222222222222222222222",
      } as never,
      { publicClient: { getCode: async () => "0x01" } } as never,
    );
    expect(reg.address("KeeperModule")).toBe("0x1111111111111111111111111111111111111111");
    expect(reg.address("ManagedRebalanceVault")).toBe("0x2222222222222222222222222222222222222222");
  });
});
