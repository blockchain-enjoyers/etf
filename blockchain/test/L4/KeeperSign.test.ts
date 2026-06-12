import { expect } from "chai";
import { ethers } from "hardhat";
import { buildUniversalPayload } from "../../keeper/sign";

describe("keeper/sign", () => {
  it("produces a payload the real UniversalSignedSource accepts", async () => {
    // two committee signers, sorted ascending by address
    const a = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const b = new ethers.Wallet("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const signers = [a, b].sort((x, y) => (x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1));

    const owner = (await ethers.getSigners())[0];
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(owner.address);
    await src.setCommittee(signers.map((s) => s.address), 2);

    const feedId = ethers.id("AAPL");
    const price = 200n * 10n ** 18n;
    const depth = 5_000_000n * 10n ** 18n;
    const lastUpdate = 1_700_000_000n;

    const payload = await buildUniversalPayload(
      { feedId, price, depth, lastUpdate },
      signers.map((s) => s.privateKey),
    );
    const r = await src.read.staticCall(payload);
    expect(r.price).to.equal(price);
    expect(r.depth).to.equal(depth);
    expect(r.healthy).to.equal(true);
  });
});
