import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, Kind } from "./helpers";

// Two constituents, ascending addresses. unitSize = 1e18. unitQty = [2e18, 3e18].
async function deploy() {
  const [owner] = await ethers.getSigners();

  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);

  // deploy two ERC20 mocks just to get two real, orderable addresses for the recipe
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0]; // strictly ascending

  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize]
    )
  );

  // a tiny vault exposing recipeCommitment()
  const Vault = await ethers.getContractFactory("MockRecipeVault");
  const vault = await Vault.deploy(commitment);

  // register two healthy deep sources per constituent at 100 and 200
  const Mock = await ethers.getContractFactory("MockSource");
  async function reg(asset: string, price: bigint) {
    const now = await time.latest();
    const s1 = await Mock.deploy(); await s1.set(price, 10_000_000n * ONE, BigInt(now), Kind.AMM_TWAP, 0n, true, true);
    const s2 = await Mock.deploy(); await s2.set(price, 10_000_000n * ONE, BigInt(now), Kind.AMM_TWAP, 0n, true, true);
    await agg.addSource(asset, await s1.getAddress());
    await agg.addSource(asset, await s2.getAddress());
  }
  await reg(t0, 100n * ONE);
  await reg(t1, 200n * ONE);

  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());

  // payloads[constituent][source]
  const payloads = [["0x", "0x"], ["0x", "0x"]];
  return { nav, vault, agg, tokens, unitQty, unitSize, payloads };
}

describe("FairValueNAV — sum-of-parts", () => {
  it("computes nav = sum(unitQty_i * price_i)", async () => {
    const { nav, vault, tokens, unitQty, unitSize, payloads } = await loadFixture(deploy);
    const r = await nav.navOf(await vault.getAddress(), tokens, unitQty, unitSize, payloads);
    // 2*100 + 3*200 = 800
    expect(r.nav).to.equal(800n * ONE);
    expect(r.safe).to.equal(true);
  });

  it("reverts on a recipe that does not match the vault commitment", async () => {
    const { nav, vault, tokens, unitQty, unitSize, payloads } = await loadFixture(deploy);
    const badQty = [unitQty[0], unitQty[1] + 1n];
    await expect(
      nav.navOf(await vault.getAddress(), tokens, badQty, unitSize, payloads)
    ).to.be.revertedWithCustomError(nav, "RecipeMismatch");
  });
});

describe("FairValueNAV — whole-basket cross-check", () => {
  async function deployWithBasket(directPrice: bigint) {
    const f = await loadFixture(deploy);
    const aggAddr = await (f.nav.aggregator());
    const agg = await ethers.getContractAt("PriceAggregator", aggAddr);
    const [owner] = await ethers.getSigners();
    // register two direct whole-basket sources keyed by the vault address, priced per unit
    const Mock = await ethers.getContractFactory("MockSource");
    const now = await time.latest();
    for (let i = 0; i < 2; i++) {
      const s = await Mock.deploy();
      await s.set(directPrice, 10_000_000n * ONE, BigInt(now), Kind.AMM_TWAP, 0n, true, true);
      await agg.connect(owner).addSource(await f.vault.getAddress(), await s.getAddress());
    }
    return f;
  }

  it("safe when sum-of-parts agrees with the direct basket price (800)", async () => {
    const f = await deployWithBasket(800n * ONE);
    const r = await f.nav.navWithBasketCheck(
      await f.vault.getAddress(), f.tokens, f.unitQty, f.unitSize, f.payloads, ["0x", "0x"]
    );
    expect(r.safe).to.equal(true);
  });

  it("unsafe when the direct basket price diverges (900 vs 800)", async () => {
    const f = await deployWithBasket(900n * ONE);
    const r = await f.nav.navWithBasketCheck(
      await f.vault.getAddress(), f.tokens, f.unitQty, f.unitSize, f.payloads, ["0x", "0x"]
    );
    expect(r.safe).to.equal(false);
  });
});
