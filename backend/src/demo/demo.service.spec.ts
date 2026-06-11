import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DemoService } from "./demo.service.js";

describe("DemoService", () => {
  const service = new DemoService();

  it("returns a known series by id", () => {
    const s = service.get("weekend-gap");
    expect(s.name).toContain("Weekend Gap");
    expect(s.frames.length).toBeGreaterThan(0);
  });

  it("throws NotFound for an unknown id", () => {
    expect(() => service.get("nope")).toThrow(NotFoundException);
  });

  it("lists all series", () => {
    expect(service.list().length).toBeGreaterThanOrEqual(3);
  });
});
