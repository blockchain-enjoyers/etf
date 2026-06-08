import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const EMPTY = "0x";
const FEED = ethers.id("A");

async function deploy() {
  const [owner, vault] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);

  // two healthy deep sources @ 100 so the holdings aggregate is safe (k>=2)
  const Mock = await ethers.getContractFactory("MockSource");
  for (let i = 0; i < 2; i++) {
    const m = await Mock.deploy();
    await m.set(100n * ONE, 10_000_000n * ONE, BigInt(await time.latest()), 1, 0n, false, true);
    await agg.addSource(await a.getAddress(), await m.getAddress());
  }
  await a.mint(vault.address, 5n * ONE); // holdings nav = 5 * 100 = 500

  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());

  const Index = await ethers.getContractFactory("MockIndexReturn");
  const index = await Index.deploy();
  await index.set(0); // r_index = 0 => P̂ = lastClose

  const signer = ethers.Wallet.createRandom();
  const Beta = await ethers.getContractFactory("BetaProjectionSource");
  const beta = await Beta.deploy(owner.address, await index.getAddress(), 1n * ONE); // low cap depth
  await beta.setCommittee([signer.address], 1);

  async function betaPayload(lastClose: bigint) {
    const b = ONE; // beta = 1.0
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "bytes32", "int256", "uint256"],
        ["beta-projection", FEED, b, lastClose]
      )
    );
    const s = ethers.Signature.from(await signer.signingKey.sign(digest));
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "int256", "uint256", "bytes32[]", "bytes32[]", "uint8[]"],
      [FEED, b, lastClose, [s.r], [s.s], [s.v]]
    );
  }

  return { nav, agg, a, vault, beta, betaPayload };
}

describe("FairValueNAV.navWithBetaCheck (EP-3 beta veto)", () => {
  it("safe stays true when the beta projection agrees with holdings", async () => {
    const { nav, a, vault, beta, betaPayload } = await loadFixture(deploy);
    const tokens = [await a.getAddress()];
    const payloads = [[EMPTY, EMPTY]];
    const bp = [await betaPayload(100n * ONE)]; // P̂ = 100 => betaNav = 500 == holdings
    const r = await nav.navWithBetaCheck.staticCall(vault.address, tokens, payloads, await beta.getAddress(), bp, 200);
    expect(r.nav).to.equal(500n * ONE);
    expect(r.safe).to.equal(true);
  });

  it("vetoes (safe=false) when the beta projection diverges beyond the band", async () => {
    const { nav, a, vault, beta, betaPayload } = await loadFixture(deploy);
    const tokens = [await a.getAddress()];
    const payloads = [[EMPTY, EMPTY]];
    const bp = [await betaPayload(200n * ONE)]; // P̂ = 200 => betaNav = 1000, 100% divergence
    const r = await nav.navWithBetaCheck.staticCall(vault.address, tokens, payloads, await beta.getAddress(), bp, 200);
    expect(r.safe).to.equal(false);
  });
});
