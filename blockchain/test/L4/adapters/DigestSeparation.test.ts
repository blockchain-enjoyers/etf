import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const FEED = ethers.id("TSLA");

// A signature valid for RedStone must NOT be replayable through Beta even when the SAME key sits on both
// committees — the digests are domain-separated. (Regression for the cross-adapter replay review finding.)
async function deploy() {
  const [owner] = await ethers.getSigners();
  const shared = ethers.Wallet.createRandom();

  const Red = await ethers.getContractFactory("RedStoneSource");
  const red = await Red.deploy(owner.address, 5_000_000n * ONE, true);
  await red.setCommittee([shared.address], 1);

  const Index = await ethers.getContractFactory("MockIndexReturn");
  const index = await Index.deploy();
  await index.set(0);
  const Beta = await ethers.getContractFactory("BetaProjectionSource");
  const beta = await Beta.deploy(owner.address, await index.getAddress(), 1n * ONE);
  await beta.setCommittee([shared.address], 1);

  return { red, beta, shared };
}

describe("Signed-adapter digest domain separation", () => {
  it("a RedStone signature cannot be replayed through Beta (shared committee key)", async () => {
    const { red, beta, shared } = await loadFixture(deploy);
    const ts = await time.latest();
    const price = 300n * ONE;

    // sign RedStone's digest
    const redDigest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32", "uint256", "uint64"], ["redstone", FEED, price, ts])
    );
    const s = ethers.Signature.from(await shared.signingKey.sign(redDigest));

    // it works on RedStone
    const redPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
      [FEED, price, ts, [s.r], [s.s], [s.v]]
    );
    expect((await red.read.staticCall(redPayload)).price).to.equal(price);

    // replay the SAME sig through Beta (feedId, beta=price, lastClose=ts) -> different digest -> rejected
    const betaPayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "int256", "uint256", "bytes32[]", "bytes32[]", "uint8[]"],
      [FEED, price, ts, [s.r], [s.s], [s.v]]
    );
    await expect(beta.read.staticCall(betaPayload)).to.be.revertedWithCustomError(beta, "ThresholdNotMet");
  });
});
