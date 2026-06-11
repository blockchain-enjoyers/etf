import { describe, expect, it, vi } from "vitest";
import { createHermesClient } from "./hermes-client.js";

const BODY = {
  parsed: [{ id: "abc", price: { price: "30012345678", conf: "12345678", expo: -8, publish_time: 1_780_000_000 } }],
};

describe("createHermesClient", () => {
  it("fetches and maps the latest price", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => BODY });
    const c = createHermesClient("https://h.example", fetchImpl as never);
    const p = await c.getLatestPrice("0xabc");
    expect(fetchImpl).toHaveBeenCalledWith("https://h.example/v2/updates/price/latest?ids[]=0xabc");
    expect(p).toEqual({ price: 30012345678n, conf: 12345678n, expo: -8, publishTime: 1_780_000_000 });
  });
  it("returns undefined on http error or empty body", async () => {
    const bad = createHermesClient("https://h.example", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never);
    expect(await bad.getLatestPrice("0x1")).toBeUndefined();
    const empty = createHermesClient("https://h.example", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ parsed: [] }) }) as never);
    expect(await empty.getLatestPrice("0x1")).toBeUndefined();
  });
});
