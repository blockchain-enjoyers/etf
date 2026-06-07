import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, Kind, deployMock, EMPTY } from "./helpers";

describe("MockSource", () => {
  it("returns the reading set via set()", async () => {
    const m = await loadFixture(deployMock);
    await m.set(300n * ONE, 1_000_000n * ONE, 1700000000n, Kind.AMM_TWAP, ONE, false, true);
    const r = await m.readSource(EMPTY);
    expect(r.price).to.equal(300n * ONE);
    expect(r.depth).to.equal(1_000_000n * ONE);
    expect(r.healthy).to.equal(true);
    expect(r.weekendAware).to.equal(false);
  });

  it("field setters mutate individual fields", async () => {
    const m = await loadFixture(deployMock);
    await m.setPrice(123n * ONE);
    await m.setHealthy(false);
    const r = await m.readSource(EMPTY);
    expect(r.price).to.equal(123n * ONE);
    expect(r.healthy).to.equal(false);
  });
});
