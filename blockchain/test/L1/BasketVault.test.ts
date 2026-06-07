import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, Leg } from "../helpers";
import { deployCloneFactory, deployBasketVault } from "./helpers";

// Recipe per 1 creation-unit (before sorting): 2 / 3 / 5 of each stock. unitSize = 1e18.
async function deployVaultFixture() {
  const [deployer, ap, alice] = await ethers.getSigners();

  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();

  const tsla = await deployStock(registry, "Tesla", "TSLA");
  const amzn = await deployStock(registry, "Amazon", "AMZN");
  const nvda = await deployStock(registry, "Nvidia", "NVDA");

  const legs: Leg[] = sortRecipe([
    { stock: tsla, addr: await tsla.getAddress(), qty: 2n * ONE },
    { stock: amzn, addr: await amzn.getAddress(), qty: 3n * ONE },
    { stock: nvda, addr: await nvda.getAddress(), qty: 5n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr);
  const unitQty = legs.map((l) => l.qty);
  const unitSize = ONE;

  // Deploy via CloneFactory (instead of direct constructor deploy).
  const vault = await deployBasketVault(tokens, unitQty, unitSize, "Basket", "BSK");
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  // Fund the AP with plenty of each constituent.
  for (const l of legs) {
    await (await l.stock.mint(ap.address, 1000n * ONE)).wait();
  }

  // Approve the AP's stocks to the vault for a given number of units.
  async function approveFor(signer: any, nUnits: bigint) {
    for (const l of legs) {
      await (await l.stock.connect(signer).approve(vaultAddr, l.qty * nUnits)).wait();
    }
  }

  return { deployer, ap, alice, registry, legs, tokens, unitQty, unitSize, vault, vaultAddr, approveFor };
}

describe("BasketVault — L1 static in-kind", () => {
  describe("constructor / recipe", () => {
    it("stores the recipe and unitSize", async () => {
      const { vault, tokens, unitQty, unitSize } = await loadFixture(deployVaultFixture);
      const [t, q] = await vault.getConstituents();
      expect(t).to.deep.equal(tokens);
      expect(q).to.deep.equal(unitQty);
      expect(await vault.unitSize()).to.equal(unitSize);
      expect(await vault.constituentsCount()).to.equal(3);
    });

    it("reverts on length mismatch", async () => {
      const { tokens } = await loadFixture(deployVaultFixture);
      const factory = await deployCloneFactory();
      const salt = ethers.id("mismatch");
      await expect(
        factory.createBasket([tokens[0], tokens[1]], [ONE], ONE, "x", "x", salt)
      ).to.be.reverted;
    });

    it("reverts on empty basket", async () => {
      const factory = await deployCloneFactory();
      const salt = ethers.id("empty");
      await expect(
        factory.createBasket([], [], ONE, "x", "x", salt)
      ).to.be.reverted;
    });

    it("reverts on zero unitSize", async () => {
      const { tokens, unitQty } = await loadFixture(deployVaultFixture);
      const factory = await deployCloneFactory();
      // unitSize is in clone-args; __VaultCore_init re-asserts the invariant (a unitSize-0 vault mints 0).
      const impl = await (await ethers.getContractFactory("BasketVault")).deploy();
      await expect(
        factory.createBasket(tokens, unitQty, 0, "x", "x", ethers.id("zerounitsz"))
      ).to.be.revertedWithCustomError(impl, "ZeroUnitSize");
    });

    it("reverts on unsorted / duplicate tokens", async () => {
      const { tokens, unitQty } = await loadFixture(deployVaultFixture);
      const factory = await deployCloneFactory();
      const reversed = [...tokens].reverse();
      await expect(
        factory.createBasket(reversed, unitQty, ONE, "x", "x", ethers.id("rev"))
      ).to.be.reverted;
      await expect(
        factory.createBasket([tokens[0], tokens[0]], [ONE, ONE], ONE, "x", "x", ethers.id("dup"))
      ).to.be.reverted;
    });

    it("reverts on zero quantity", async () => {
      const { tokens } = await loadFixture(deployVaultFixture);
      const factory = await deployCloneFactory();
      await expect(
        factory.createBasket(tokens, [ONE, 0n, ONE], ONE, "x", "x", ethers.id("zeroqty"))
      ).to.be.reverted;
    });
  });

  describe("create", () => {
    it("pulls the exact bundle and mints nUnits*unitSize", async () => {
      const { ap, legs, vault, vaultAddr, unitSize, approveFor } = await loadFixture(deployVaultFixture);
      await approveFor(ap, 3n);
      await expect(vault.connect(ap).create(3n))
        .to.emit(vault, "Created")
        .withArgs(ap.address, 3n, 3n * unitSize);

      expect(await vault.totalSupply()).to.equal(3n * unitSize);
      expect(await vault.balanceOf(ap.address)).to.equal(3n * unitSize);
      for (const l of legs) {
        expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty * 3n);
      }
    });

    it("previewCreate matches the pulled amounts", async () => {
      const { vault, tokens, unitQty } = await loadFixture(deployVaultFixture);
      const [t, a] = await vault.previewCreate(3n);
      expect(t).to.deep.equal(tokens);
      expect(a).to.deep.equal(unitQty.map((q) => q * 3n));
    });

    it("reverts on zero units", async () => {
      const { ap, vault } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(ap).create(0n)).to.be.revertedWithCustomError(vault, "ZeroUnits");
    });

    it("reverts on an incomplete bundle (one leg not approved)", async () => {
      const { ap, legs, vault, vaultAddr } = await loadFixture(deployVaultFixture);
      // approve only the first two legs
      await (await legs[0].stock.connect(ap).approve(vaultAddr, legs[0].qty)).wait();
      await (await legs[1].stock.connect(ap).approve(vaultAddr, legs[1].qty)).wait();
      await expect(vault.connect(ap).create(1n)).to.be.reverted; // 3rd leg transferFrom fails
    });
  });

  describe("redeem", () => {
    it("returns the pro-rata bundle and burns shares", async () => {
      const { ap, legs, vault, vaultAddr, unitSize, approveFor } = await loadFixture(deployVaultFixture);
      await approveFor(ap, 3n);
      await vault.connect(ap).create(3n);

      const before = await Promise.all(legs.map((l) => l.stock.balanceOf(ap.address)));
      await expect(vault.connect(ap).redeem(unitSize))
        .to.emit(vault, "Redeemed")
        .withArgs(ap.address, unitSize);

      expect(await vault.totalSupply()).to.equal(2n * unitSize);
      // redeeming 1 unit worth of a 3-unit supply returns exactly qty per leg
      for (let i = 0; i < legs.length; i++) {
        const after = await legs[i].stock.balanceOf(ap.address);
        expect(after - before[i]).to.equal(legs[i].qty);
        expect(await legs[i].stock.balanceOf(vaultAddr)).to.equal(legs[i].qty * 2n);
      }
    });

    it("uses supply BEFORE burn as denominator (two holders, pro-rata)", async () => {
      const { ap, alice, legs, vault, vaultAddr, unitSize, approveFor } = await loadFixture(deployVaultFixture);
      // AP creates 2 units, then transfers 1 unit of shares to alice
      await approveFor(ap, 2n);
      await vault.connect(ap).create(2n);
      await vault.connect(ap).transfer(alice.address, unitSize);

      // supply = 2 units; alice redeems 1 unit -> gets exactly one unit's worth
      const before = await legs[0].stock.balanceOf(alice.address);
      await vault.connect(alice).redeem(unitSize);
      const got = (await legs[0].stock.balanceOf(alice.address)) - before;
      expect(got).to.equal(legs[0].qty);
      expect(await vault.totalSupply()).to.equal(unitSize);
      // vault still backs the remaining 1 unit held by AP
      expect(await legs[0].stock.balanceOf(vaultAddr)).to.equal(legs[0].qty);
    });

    it("previewRedeem matches the actual payout", async () => {
      const { ap, vault, unitSize, approveFor, tokens } = await loadFixture(deployVaultFixture);
      await approveFor(ap, 3n);
      await vault.connect(ap).create(3n);
      const [t, a] = await vault.previewRedeem(unitSize);
      expect(t).to.deep.equal(tokens);
      // 1 unit out of 3 -> one unit's worth each
      const [, expected] = await vault.previewCreate(1n);
      expect(a).to.deep.equal(expected);
    });

    it("reverts on zero amount", async () => {
      const { ap, vault } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(ap).redeem(0n)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts with NoSupply on an empty vault", async () => {
      const { ap, vault } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(ap).redeem(ONE)).to.be.revertedWithCustomError(vault, "NoSupply");
    });
  });
});
