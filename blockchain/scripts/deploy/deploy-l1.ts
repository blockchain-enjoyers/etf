// L1 — vault implementations + the CloneFactory that mints them as EIP-1167 clones.
//
//   npx hardhat run scripts/deploy/deploy-l1.ts --network robinhoodTestnet
//
// Deploys the three implementation contracts (no constructor args — initializers are disabled
// in VaultCore, so they are never called directly) and then the CloneFactory wired to all three.
// Individual baskets are NOT deployed here: issuers mint them at runtime via factory.createBasket /
// createCommittedBasket / createManagedBasket (clone-with-immutable-args).
//
// Post-deploy: CloneFactory.meridian/treasury default to the deployer and platformFeeBps to 15
// (0.15%). Adjust later with setMeridian/setTreasury/setPlatformFeeBps as the owner.
import { ensure, getDeployer, loadConfig, EXPLORER } from "./_shared";
import { ethers } from "hardhat";

export async function deployL1() {
  console.log("== L1: vault implementations + CloneFactory + USDG + fee globals ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const basketImpl = await ensure(config, "BasketVault", [], deployer);
  const managedImpl = await ensure(config, "ManagedVault", [], deployer);
  const committedImpl = await ensure(config, "CommittedVault", [], deployer);
  const factory = await ensure(config, "CloneFactory", [basketImpl, managedImpl, committedImpl], deployer);

  // 18-decimal mock USDG: FeeCore.FLAT_FEE_MAX==100e18 assumes 18 decimals (~$100 cap).
  const usdg = await ensure(config, "MockERC20Decimals", ["USD Global", "USDG", 18], deployer, "USDG");

  // Fee globals injected into every managed/registry clone. Flat fees default to 1 USDG each (cost-recovery).
  const f = await ethers.getContractAt("CloneFactory", factory);
  if ((await f.feeToken()) !== usdg) {
    console.log("  wiring: factory.setFeeToken(USDG)");
    await (await f.setFeeToken(usdg)).wait();
  }
  const oneUsdg = 10n ** 18n;
  if ((await f.defaultFlatCreateFee()) !== oneUsdg || (await f.defaultFlatRedeemFee()) !== oneUsdg) {
    console.log("  wiring: factory.setDefaultFlatFees(1 USDG, 1 USDG)");
    await (await f.setDefaultFlatFees(oneUsdg, oneUsdg)).wait();
  }

  console.log(`\n✅ L1 ready. Factory: ${EXPLORER}${factory}  USDG: ${usdg}\n`);
  return { basketImpl, managedImpl, committedImpl, factory, usdg };
}

if (require.main === module) {
  deployL1().catch((err) => { console.error(err); process.exitCode = 1; });
}
