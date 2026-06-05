import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  MINTER_ROLE,
  MULTIPLIER_UPDATER_ROLE,
  TOKEN_PAUSER_ROLE,
  deployRegistry,
  deployStock,
  sortRecipe,
  Leg,
} from "../helpers";

// Base fixture: registry + 3 sorted stocks + a vault (qty 2/3/5, unitSize 1e18), AP funded.
async function fix() {
  const [deployer, ap, alice] = await ethers.getSigners();
  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();

  const a = await deployStock(registry, "Tesla", "TSLA");
  const b = await deployStock(registry, "Amazon", "AMZN");
  const c = await deployStock(registry, "Nvidia", "NVDA");

  const legs: Leg[] = sortRecipe([
    { stock: a, addr: await a.getAddress(), qty: 2n * ONE },
    { stock: b, addr: await b.getAddress(), qty: 3n * ONE },
    { stock: c, addr: await c.getAddress(), qty: 5n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr);
  const unitQty = legs.map((l) => l.qty);

  const Vault = await ethers.getContractFactory("BasketVault");
  const vault = await Vault.deploy(tokens, unitQty, ONE, "Basket", "BSK");
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  for (const l of legs) await (await l.stock.mint(ap.address, 1000n * ONE)).wait();

  async function approveTo(target: string, signer: any, qtys: bigint[], nUnits: bigint) {
    for (let i = 0; i < legs.length; i++) {
      await (await legs[i].stock.connect(signer).approve(target, qtys[i] * nUnits)).wait();
    }
  }

  return { deployer, ap, alice, registry, legs, tokens, unitQty, vault, vaultAddr, Vault, approveTo };
}

describe("BasketVault — edge cases (token interaction, dust, nesting)", () => {
  describe("scaled-UI multiplier (stock split) is raw-safe", () => {
    it("a split changes only the UI view; raw balances and redeem payout are unchanged", async () => {
      const { deployer, ap, registry, legs, vault, vaultAddr, unitQty, approveTo } = await loadFixture(fix);
      await approveTo(vaultAddr, ap, unitQty, 3n);
      await vault.connect(ap).create(3n);

      const rawBefore = await legs[0].stock.balanceOf(vaultAddr);

      // 2:1 split on leg 0
      await (await registry.grantRole(MULTIPLIER_UPDATER_ROLE, deployer.address)).wait();
      await (await legs[0].stock.updateMultiplier(2n * ONE)).wait();

      // raw ledger untouched, only the UI view doubled
      expect(await legs[0].stock.balanceOf(vaultAddr)).to.equal(rawBefore);
      expect(await legs[0].stock.balanceOfUI(vaultAddr)).to.equal(rawBefore * 2n);

      // redeeming 1 of 3 units still returns the same RAW quantity as before the split
      const apBefore = await legs[0].stock.balanceOf(ap.address);
      await vault.connect(ap).redeem(ONE);
      expect((await legs[0].stock.balanceOf(ap.address)) - apBefore).to.equal(legs[0].qty);
    });
  });

  describe("a paused constituent freezes redeem (liveness, not loss)", () => {
    it("redeem reverts while any leg is paused and recovers once unpaused", async () => {
      const { deployer, ap, registry, legs, vault, vaultAddr, unitQty, approveTo } = await loadFixture(fix);
      await approveTo(vaultAddr, ap, unitQty, 3n);
      await vault.connect(ap).create(3n);

      await (await registry.grantRole(TOKEN_PAUSER_ROLE, deployer.address)).wait();
      await (await legs[0].stock.pause()).wait();

      await expect(vault.connect(ap).redeem(ONE)).to.be.reverted;

      // assets are intact; redemption resumes the moment the constituent unpauses
      await (await legs[0].stock.unpause()).wait();
      await expect(vault.connect(ap).redeem(ONE)).to.not.be.reverted;
    });
  });

  describe("dust / round-to-zero on a tiny-qty leg", () => {
    it("a sub-unit redeem pays 0 of the dust leg (skipped, no revert); full drain sweeps it", async () => {
      const { ap, tokens, legs, Vault, vaultAddr } = await loadFixture(fix);
      // dust basket: leg 0 has qty = 1 wei against unitSize 1e18
      const dustQty = [1n, 3n * ONE, 5n * ONE];
      const dust = await Vault.deploy(tokens, dustQty, ONE, "Dust", "DST");
      await dust.waitForDeployment();
      const dustAddr = await dust.getAddress();
      for (let i = 0; i < legs.length; i++) {
        await (await legs[i].stock.connect(ap).approve(dustAddr, dustQty[i])).wait();
      }
      await dust.connect(ap).create(1n); // supply = 1e18; vault holds 1 wei of leg 0

      // redeem half a unit: leg0 out = 1*5e17/1e18 = 0 -> skipped, no revert
      const stock0 = legs[0].stock;
      const before0 = await stock0.balanceOf(ap.address);
      await dust.connect(ap).redeem(ONE / 2n);
      expect((await stock0.balanceOf(ap.address)) - before0).to.equal(0n);
      expect(await stock0.balanceOf(dustAddr)).to.equal(1n); // dust still in vault

      // full drain of remaining supply sweeps the dust wei and zeroes supply
      const remaining = await dust.balanceOf(ap.address);
      await dust.connect(ap).redeem(remaining);
      expect(await dust.totalSupply()).to.equal(0n);
      expect(await stock0.balanceOf(dustAddr)).to.equal(0n);
    });
  });

  describe("nested basket (a vault share token as a constituent)", () => {
    it("create/redeem round-trips through both levels pro-rata", async () => {
      const { ap, legs, vault, vaultAddr, unitQty, Vault, approveTo } = await loadFixture(fix);
      // AP creates 2 sub-basket units
      await approveTo(vaultAddr, ap, unitQty, 2n);
      await vault.connect(ap).create(2n); // ap holds 2e18 sub-shares

      // Top basket holds the sub-basket token, 1 sub-share per unit
      const top = await Vault.deploy([vaultAddr], [ONE], ONE, "Top", "TOP");
      await top.waitForDeployment();
      const topAddr = await top.getAddress();

      await (await vault.connect(ap).approve(topAddr, 2n * ONE)).wait();
      await top.connect(ap).create(2n); // deposits 2e18 sub-shares, ap gets 2e18 top-shares
      expect(await vault.balanceOf(topAddr)).to.equal(2n * ONE);

      // redeem 1 top unit -> get 1 sub-share back
      await top.connect(ap).redeem(ONE);
      expect(await vault.balanceOf(ap.address)).to.equal(ONE); // 2 created - 1 left in top + 1 back = 1

      // redeem that sub-share -> get underlying stocks (1 of original 2 units worth)
      const before = await legs[0].stock.balanceOf(ap.address);
      await vault.connect(ap).redeem(ONE);
      expect((await legs[0].stock.balanceOf(ap.address)) - before).to.equal(legs[0].qty);
    });
  });
});
