import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const EXEC = { MANAGER_ONLY: 0, ALLOWLIST: 1, PERMISSIONLESS: 2 };

// Inlined from test/L3/RebalanceAuction.test.ts — same deploy steps, same wiring.
async function deployAuctionFixture() {
  const [deployer, manager, meridian, treasury, keeper, bidder] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let pairs = [
    [await a.getAddress(), a],
    [await b.getAddress(), b],
  ].sort((x, y) => (BigInt(x[0] as string) < BigInt(y[0] as string) ? -1 : 1));
  const tokens = pairs.map((p) => p[0] as string);
  const unitQty = [10n * ONE, 10n * ONE];
  const unitSize = ONE;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();

  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "uint256"],
      [tokens, unitQty, unitSize]
    )
  );
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32"],
    [unitSize, commitment]
  );
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt(
    "ManagedRebalanceVault",
    await helper.lastClone()
  );

  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address,
    meridian: meridian.address,
    treasury: treasury.address,
    managerFeeBps: 200,
    platformFeeBps: 15,
    keeperBps: 250,
    keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress,
    flatCreateFee: 0n,
    flatRedeemFee: 0n,
  });

  const [tA, tB] = tokens;
  const cA = pairs.find((p) => p[0] === tA)![1] as any;
  const cB = pairs.find((p) => p[0] === tB)![1] as any;
  await cA.mint(deployer.address, 10n * ONE);
  await cB.mint(deployer.address, 10n * ONE);
  await cA.approve(await vault.getAddress(), 10n * ONE);
  await cB.approve(await vault.getAddress(), 10n * ONE);
  await vault.create(ONE);
  await time.increase(365 * 24 * 3600);
  await vault.accrueFee();

  const Auc = await ethers.getContractFactory("RebalanceAuction");
  const auction = await Auc.deploy(await km.getAddress(), 5n * 10n ** 15n); // maxTip 0.005 share

  await vault.connect(meridian).setExecutor(await auction.getAddress(), true);
  await km.connect(deployer).setExecutor(await auction.getAddress(), true);
  await km.connect(deployer).setMaxRewardPerCall(ONE);
  await auction.connect(manager).setExecMode(await vault.getAddress(), EXEC.MANAGER_ONLY);

  // release = tA (vault holds it), releaseOut = 4*ONE — a valid non-empty release side
  const release = [tA];
  const releaseOut = [4n * ONE];

  return { auction, vault, manager, bidder, tokens, pairs, release, releaseOut };
}

describe("RebalanceAuction — empty acquire is rejected (H4)", () => {
  it("open() with acquire.length==0 reverts InvalidAuctionParams", async () => {
    const { auction, vault, manager, release, releaseOut } = await loadFixture(
      deployAuctionFixture
    );
    await expect(
      auction
        .connect(manager)
        .open(await vault.getAddress(), release, releaseOut, [], [], [], 3600)
    ).to.be.revertedWithCustomError(auction, "InvalidAuctionParams");
  });
});
