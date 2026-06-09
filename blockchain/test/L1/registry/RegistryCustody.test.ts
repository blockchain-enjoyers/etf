import { expect } from "chai";
import { ethers } from "hardhat";

const UNIT = 10n ** 18n;

async function deploy() {
  const [deployer, ap, user] = await ethers.getSigners();
  const token = await (
    await ethers.getContractFactory("MockERC20Decimals")
  ).deploy("Nvidia", "NVDAx", 18);
  await token.waitForDeployment();
  const H = await (await ethers.getContractFactory("RegistryCustodyHarness")).deploy();
  await H.waitForDeployment();
  await H.initialize();
  return { deployer, ap, user, token, H };
}

describe("RegistryCustody — wrap/unwrap", () => {
  it("idOf/tokenOf round-trip", async () => {
    const { H, token } = await deploy();
    const addr = await token.getAddress();
    const id = await H.idOf(addr);
    expect(await H.tokenOf(id)).to.equal(addr);
  });

  it("wrap pulls the real token and mints an equal claim id", async () => {
    const { ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 100n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 100n * UNIT);

    await H.connect(ap).wrap(addr, 40n * UNIT);

    expect(await token.balanceOf(await H.getAddress())).to.equal(40n * UNIT);
    expect(await H["balanceOf(address,uint256)"](ap.address, await H.idOf(addr))).to.equal(40n * UNIT);
  });

  it("unwrap burns the claim and returns the real token to `to`", async () => {
    const { ap, user, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 100n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 100n * UNIT);
    await H.connect(ap).wrap(addr, 40n * UNIT);

    await H.connect(ap).unwrap(addr, 25n * UNIT, user.address);

    expect(await token.balanceOf(user.address)).to.equal(25n * UNIT);
    expect(await H["balanceOf(address,uint256)"](ap.address, await H.idOf(addr))).to.equal(15n * UNIT);
  });

  it("unwrap more than the claim balance reverts", async () => {
    const { ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 10n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 10n * UNIT);
    await H.connect(ap).wrap(addr, 10n * UNIT);
    await expect(H.connect(ap).unwrap(addr, 11n * UNIT, ap.address)).to.be.reverted;
  });
});

describe("RegistryCustody — internal port", () => {
  it("custodyBalance reads the vault's own claim balance", async () => {
    const { ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 50n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 50n * UNIT);
    await H.connect(ap).wrap(addr, 50n * UNIT);
    // nothing in the vault's own custody yet (claims are the AP's)
    expect(await H.custodyBalance(addr)).to.equal(0n);
    // AP moves their claims into the vault (from == ap, the claim owner)
    await H.connect(ap).custodyIn(ap.address, addr, 30n * UNIT);
    expect(await H.custodyBalance(addr)).to.equal(30n * UNIT);
  });

  it("custodyOut moves claims from the vault to a recipient, internally (no ERC-20 move)", async () => {
    const { ap, user, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 50n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 50n * UNIT);
    await H.connect(ap).wrap(addr, 50n * UNIT);
    await H.connect(ap).custodyIn(ap.address, addr, 50n * UNIT);

    const erc20Before = await token.balanceOf(await H.getAddress());
    await H.custodyOut(user.address, addr, 20n * UNIT);

    expect(await H.custodyBalance(addr)).to.equal(30n * UNIT);
    expect(await H["balanceOf(address,uint256)"](user.address, await H.idOf(addr))).to.equal(20n * UNIT);
    // the real ERC-20 never moved during the internal reassignment
    expect(await token.balanceOf(await H.getAddress())).to.equal(erc20Before);
  });

  it("the unguarded port moves a third party's claims (documents the leaf MUST pass msg.sender)", async () => {
    // _custodyIn uses internal _transfer with NO allowance/operator check. The harness exposes it openly,
    // so a non-owner can move the victim's claims. This LOCKS that fact: the real Part-2 leaf must only
    // ever call _custodyIn(msg.sender, ...). If this ever reverts, the mixin gained an (unexpected) guard.
    const { deployer, ap, token, H } = await deploy();
    const addr = await token.getAddress();
    await token.mint(ap.address, 10n * UNIT);
    await token.connect(ap).approve(await H.getAddress(), 10n * UNIT);
    await H.connect(ap).wrap(addr, 10n * UNIT); // claims owned by ap
    // deployer (NOT ap) drives custodyIn with from == ap and succeeds (no allowance enforced)
    await H.connect(deployer).custodyIn(ap.address, addr, 10n * UNIT);
    expect(await H.custodyBalance(addr)).to.equal(10n * UNIT);
  });
});
