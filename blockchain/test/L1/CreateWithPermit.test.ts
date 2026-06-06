import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  MINTER_ROLE,
  TOKEN_PAUSER_ROLE,
  deployRegistry,
  deployStock,
  sortRecipe,
  signPermit,
  SKIP_PERMIT,
  Leg,
} from "../helpers";

const DEADLINE = 10_000_000_000n; // far future

async function fix() {
  const [deployer, ap, attacker] = await ethers.getSigners();
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

  // sign permits for every leg for `nUnits` (value = unitQty * nUnits, spender = vault)
  async function permitsFor(signer: any, nUnits: bigint) {
    return Promise.all(
      legs.map((l) => signPermit(l.stock, signer, vaultAddr, l.qty * nUnits, DEADLINE))
    );
  }

  return { deployer, ap, attacker, registry, legs, tokens, unitQty, vault, vaultAddr, permitsFor };
}

describe("BasketVault.createWithPermit — EIP-2612 one-tx entry", () => {
  it("creates in one tx with no prior approve", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    // sanity: no allowances yet
    for (const l of legs) expect(await l.stock.allowance(ap.address, vaultAddr)).to.equal(0n);

    const permits = await permitsFor(ap, 3n);
    await expect(vault.connect(ap).createWithPermit(3n, permits))
      .to.emit(vault, "Created")
      .withArgs(ap.address, 3n, 3n * ONE);

    expect(await vault.balanceOf(ap.address)).to.equal(3n * ONE);
    for (const l of legs) expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty * 3n);
  });

  it("reverts on permits length mismatch", async () => {
    const { ap, vault, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);
    await expect(
      vault.connect(ap).createWithPermit(1n, permits.slice(0, 2))
    ).to.be.revertedWithCustomError(vault, "PermitsLengthMismatch");
  });

  it("skips a leg (deadline == 0) and uses a classic approve for it", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    // approve leg 0 classically; permit the rest
    await (await legs[0].stock.connect(ap).approve(vaultAddr, legs[0].qty)).wait();
    const permits = await permitsFor(ap, 1n);
    permits[0] = SKIP_PERMIT; // skip leg 0

    await vault.connect(ap).createWithPermit(1n, permits);
    expect(await vault.balanceOf(ap.address)).to.equal(ONE);
    for (const l of legs) expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty);
  });

  it("is front-run resistant: a pre-submitted permit (nonce consumed) still lets create proceed", async () => {
    const { ap, attacker, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);

    // attacker front-runs by submitting AP's leg-0 permit directly -> nonce consumed, allowance set
    await (
      await legs[0].stock
        .connect(attacker)
        .permit(ap.address, vaultAddr, permits[0].value, permits[0].deadline, permits[0].v, permits[0].r, permits[0].s)
    ).wait();
    expect(await legs[0].stock.allowance(ap.address, vaultAddr)).to.equal(legs[0].qty);

    // createWithPermit: leg-0 permit now reverts (stale nonce), caught, allowance covers need -> OK
    await vault.connect(ap).createWithPermit(1n, permits);
    expect(await vault.balanceOf(ap.address)).to.equal(ONE);
  });

  it("reverts PermitFailed when a permit fails and the allowance is insufficient", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);

    // corrupt leg-0 signature so permit reverts; no prior allowance -> PermitFailed(token)
    const bad = { ...permits[0], s: ethers.ZeroHash };
    permits[0] = bad;
    await expect(vault.connect(ap).createWithPermit(1n, permits))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(legs[0].addr);
  });

  it("reverts ZeroUnits via the permit path", async () => {
    const { ap, vault, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);
    await expect(vault.connect(ap).createWithPermit(0n, permits)).to.be.revertedWithCustomError(
      vault,
      "ZeroUnits"
    );
  });
});

describe("BasketVault.createWithPermit — adversarial / edge cases", () => {
  it("value < need -> PermitFailed (allowance check on the success branch)", async () => {
    const { ap, legs, vault, permitsFor } = await loadFixture(fix);
    // permits signed for 1 unit, but we ask for 2 -> each value (qty) < need (qty*2)
    const permits = await permitsFor(ap, 1n);
    await expect(vault.connect(ap).createWithPermit(2n, permits))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(legs[0].addr);
  });

  it("value > need -> create succeeds, vault pulls exactly the recipe, residual allowance dangles", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    const extra = 7n * ONE;
    const permits = await permitsFor(ap, 1n);
    permits[0] = await signPermit(legs[0].stock, ap, vaultAddr, legs[0].qty + extra, DEADLINE);

    await vault.connect(ap).createWithPermit(1n, permits);
    expect(await legs[0].stock.balanceOf(vaultAddr)).to.equal(legs[0].qty); // exact recipe, no over-pull
    expect(await legs[0].stock.allowance(ap.address, vaultAddr)).to.equal(extra); // documented dangle
  });

  it("paused constituent (no prior approve) -> PermitFailed", async () => {
    const { deployer, ap, registry, legs, vault, permitsFor } = await loadFixture(fix);
    await (await registry.grantRole(TOKEN_PAUSER_ROLE, deployer.address)).wait();
    await (await legs[0].stock.pause()).wait();
    const permits = await permitsFor(ap, 1n);
    await expect(vault.connect(ap).createWithPermit(1n, permits))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(legs[0].addr);
  });

  it("skipped leg whose token is paused -> reverts at transferFrom (catch does not mask the pause)", async () => {
    const { deployer, ap, registry, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    await (await legs[0].stock.connect(ap).approve(vaultAddr, legs[0].qty)).wait(); // classic approve leg 0
    const permits = await permitsFor(ap, 1n);
    permits[0] = SKIP_PERMIT;
    await (await registry.grantRole(TOKEN_PAUSER_ROLE, deployer.address)).wait();
    await (await legs[0].stock.pause()).wait();
    await expect(vault.connect(ap).createWithPermit(1n, permits)).to.be.reverted; // IsPaused at transferFrom
  });

  it("permit path end-state is identical to classic approve + create (equivalence)", async () => {
    const { ap, legs, tokens, unitQty, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    // vault2: same recipe, entered classically
    const Vault = await ethers.getContractFactory("BasketVault");
    const vault2 = await Vault.deploy(tokens, unitQty, ONE, "Basket2", "BSK2");
    await vault2.waitForDeployment();
    const vault2Addr = await vault2.getAddress();

    const permits = await permitsFor(ap, 2n);
    await vault.connect(ap).createWithPermit(2n, permits);

    for (const l of legs) await (await l.stock.connect(ap).approve(vault2Addr, l.qty * 2n)).wait();
    await vault2.connect(ap).create(2n);

    for (const l of legs) {
      expect(await l.stock.balanceOf(vaultAddr)).to.equal(await l.stock.balanceOf(vault2Addr));
    }
    expect(await vault.balanceOf(ap.address)).to.equal(await vault2.balanceOf(ap.address));
  });

  it("mixed mode: a middle leg skipped+classic-approved, others permitted (index alignment)", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    await (await legs[1].stock.connect(ap).approve(vaultAddr, legs[1].qty)).wait(); // classic approve MIDDLE leg
    const permits = await permitsFor(ap, 1n);
    permits[1] = SKIP_PERMIT;
    await vault.connect(ap).createWithPermit(1n, permits);
    for (const l of legs) expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty);
  });

  it("all-skip: every leg classic-approved, all SKIP_PERMIT, behaves like create()", async () => {
    const { ap, legs, vault, vaultAddr } = await loadFixture(fix);
    for (const l of legs) await (await l.stock.connect(ap).approve(vaultAddr, l.qty)).wait();
    const permits = legs.map(() => SKIP_PERMIT);
    await vault.connect(ap).createWithPermit(1n, permits);
    expect(await vault.balanceOf(ap.address)).to.equal(ONE);
    for (const l of legs) expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty);
  });

  it("expired (non-zero) deadline, no allowance -> PermitFailed", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);
    permits[0] = await signPermit(legs[0].stock, ap, vaultAddr, legs[0].qty, 1n); // deadline in the past
    await expect(vault.connect(ap).createWithPermit(1n, permits))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(legs[0].addr);
  });

  it("expired deadline but a prior classic allowance covers need -> create proceeds (graceful catch)", async () => {
    const { ap, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    await (await legs[0].stock.connect(ap).approve(vaultAddr, legs[0].qty)).wait();
    const permits = await permitsFor(ap, 1n);
    permits[0] = await signPermit(legs[0].stock, ap, vaultAddr, legs[0].qty, 1n); // expired, but allowance exists
    await vault.connect(ap).createWithPermit(1n, permits);
    expect(await vault.balanceOf(ap.address)).to.equal(ONE);
  });

  it("wrong-signer permit -> PermitFailed (a foreign-signed permit cannot set msg.sender's allowance)", async () => {
    const { ap, attacker, legs, vault, vaultAddr, permitsFor } = await loadFixture(fix);
    const permits = await permitsFor(ap, 1n);
    // leg 0 signed by attacker, but ap calls -> recovered owner != ap -> InvalidSigner -> caught -> PermitFailed
    permits[0] = await signPermit(legs[0].stock, attacker, vaultAddr, legs[0].qty, DEADLINE);
    await expect(vault.connect(ap).createWithPermit(1n, permits))
      .to.be.revertedWithCustomError(vault, "PermitFailed")
      .withArgs(legs[0].addr);
  });
});
