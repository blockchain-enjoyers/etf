import { describe, it, expect, vi } from "vitest";
import { SceneOracleController } from "./scene-oracle.controller.js";
import { DemoDisabledError } from "./scene-oracle.service.js";
import { NotFoundException } from "@nestjs/common";
describe("SceneOracleController", () => {
  it("delegates tamper", async () => {
    const c = new SceneOracleController({ tamper: vi.fn(async () => ({ txHash: "0xh" })) } as never);
    expect(await c.tamper({ token: "0xt", price: "1" })).toEqual({ txHash: "0xh" });
  });
  it("delegates read", async () => {
    const c = new SceneOracleController({ read: vi.fn(async () => ({ token: "0xt", mockPrice: "9" })) } as never);
    expect(await c.read("0xt")).toEqual({ token: "0xt", mockPrice: "9" });
  });
  it("maps DemoDisabledError -> 404", async () => {
    const c = new SceneOracleController({ tamper: vi.fn(async () => { throw new DemoDisabledError("off"); }) } as never);
    await expect(c.tamper({ token: "0xt", price: "1" })).rejects.toBeInstanceOf(NotFoundException);
  });
});
