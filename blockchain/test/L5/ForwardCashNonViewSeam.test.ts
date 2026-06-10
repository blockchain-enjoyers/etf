import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

// A NAV engine that MUTATES state inside navOfHoldings (mimics FairValueNAV->ChainlinkStreams.verify).
// If the L5 seam is declared `view`, calling this through it STATICCALLs and reverts.
async function deploy() {
  const Nav = await ethers.getContractFactory("MutatingNav");
  const nav = await Nav.deploy();
  const Vault = await ethers.getContractFactory("MockGateVault"); // totalSupply + heldTokens
  const vault = await Vault.deploy(ONE); // supply > 0 so record() does not revert NoSupply
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());
  return { nav, vault, obs };
}

describe("L5 NAV seam is non-view (F1)", () => {
  it("BasketNavObserver.record() does not revert with a state-mutating NAV source", async () => {
    const { vault, obs } = await loadFixture(deploy);
    await expect(obs.record(await vault.getAddress(), [], [])).to.not.be.reverted;
  });
});
