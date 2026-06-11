import { expect } from "chai";
import { ethers } from "hardhat";

describe("SignedCommitteeBase — threshold==0 fail-open (H3)", () => {
  // payload shape UniversalSignedSource.read expects: (feedId, price, depth, lastUpdate, r[], s[], v[])
  function emptySigPayload() {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
      [ethers.ZeroHash, 100n * 10n ** 18n, 1n, 0n, [], [], []],
    );
  }

  it("a fresh adapter (threshold==0) rejects a zero-signature payload", async () => {
    const [deployer] = await ethers.getSigners();
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(deployer.address); // no setCommittee -> threshold 0
    await expect(src.read(emptySigPayload())).to.be.revertedWithCustomError(src, "ThresholdNotMet");
  });

  it("setCommittee rejects threshold 0 and threshold > members", async () => {
    const [deployer, a, b] = await ethers.getSigners();
    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const src = await Src.deploy(deployer.address);
    await expect(src.setCommittee([a.address, b.address], 0)).to.be.revertedWithCustomError(src, "ThresholdNotMet");
    await expect(src.setCommittee([a.address, b.address], 3)).to.be.revertedWithCustomError(src, "ThresholdNotMet");
    await expect(src.setCommittee([a.address, b.address], 2)).to.not.be.reverted; // valid
  });
});
