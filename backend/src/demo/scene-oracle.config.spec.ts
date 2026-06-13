import { describe, it, expect } from "vitest";
import { SceneOracleConfig } from "./scene-oracle.config.js";
const cfg = (mode: string, scene: string) =>
  new SceneOracleConfig({ get: (k: string) => (k === "DEMO_MODE" ? mode === "true" : scene) } as never);
describe("SceneOracleConfig", () => {
  it("parses scene + isSceneToken (case-insensitive) + mockFor", () => {
    const c = cfg("true", '{"0xAAA":"0xMOCK"}');
    expect(c.enabled).toBe(true);
    expect(c.isSceneToken("0xaaa")).toBe(true);
    expect(c.mockFor("0xAAA")).toBe("0xMOCK");
    expect(c.tokens()).toEqual(["0xaaa"]);
  });
  it("disabled + empty scene by default", () => {
    const c = cfg("false", "{}");
    expect(c.enabled).toBe(false);
    expect(c.isSceneToken("0xa")).toBe(false);
  });
  it("tolerates malformed DEMO_SCENE json", () => {
    const c = cfg("true", "not-json");
    expect(c.tokens()).toEqual([]);
  });
});
