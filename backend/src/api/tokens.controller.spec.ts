import { describe, expect, it, vi } from "vitest";
import { demoTokens } from "@meridian/contracts";
import { TokensController } from "./tokens.controller.js";
import type { TokenMetadataService } from "../contracts/token-metadata.service.js";

const NVDA = demoTokens.find((t) => t.symbol === "NVDA")!;

function make(getMany = vi.fn().mockResolvedValue({})) {
  const meta = { getMany } as unknown as TokenMetadataService;
  return { ctrl: new TokensController(meta), getMany };
}

describe("TokensController.search", () => {
  it("returns rows including NVDA for query 'NV'", () => {
    const { ctrl } = make();
    const out = ctrl.search("NV");
    expect(out.some((r) => r.symbol === "NVDA")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    const hit = out.find((r) => r.symbol === "NVDA")!;
    expect(hit.token).toBe(NVDA.address);
    expect(hit.name).toBe(NVDA.name);
  });

  it("returns [] for a blank query", () => {
    const { ctrl } = make();
    expect(ctrl.search("   ")).toEqual([]);
    expect(ctrl.search(undefined)).toEqual([]);
  });
});

describe("TokensController.resolve", () => {
  it("maps a known demoTokens address to its symbol without calling getMany", async () => {
    const { ctrl, getMany } = make();
    const out = await ctrl.resolve({ addresses: [NVDA.address.toUpperCase()] });
    expect(out).toEqual([{ token: NVDA.address, symbol: NVDA.symbol, name: NVDA.name }]);
    expect(getMany).not.toHaveBeenCalled();
  });

  it("falls back to getMany for an unknown address", async () => {
    const unknown = "0x000000000000000000000000000000000000dead";
    const getMany = vi.fn().mockResolvedValue({
      [unknown]: { token: unknown, symbol: "WHO", name: "Mystery", decimals: 18 },
    });
    const { ctrl } = make(getMany);
    const out = await ctrl.resolve({ addresses: [unknown] });
    expect(getMany).toHaveBeenCalledWith([unknown]);
    expect(out).toEqual([{ token: unknown, symbol: "WHO", name: "Mystery" }]);
  });

  it("preserves input order across known + unknown addresses", async () => {
    const unknown = "0x000000000000000000000000000000000000beef";
    const getMany = vi.fn().mockResolvedValue({ [unknown]: { token: unknown, symbol: "BEEF", name: null, decimals: 18 } });
    const { ctrl } = make(getMany);
    const out = await ctrl.resolve({ addresses: [unknown, NVDA.address] });
    expect(out.map((r) => r.symbol)).toEqual(["BEEF", "NVDA"]);
  });
});
