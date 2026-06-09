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

export async function deployL1() {
  console.log("== L1: vault implementations + CloneFactory ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const basketImpl = await ensure(config, "BasketVault", [], deployer);
  const managedImpl = await ensure(config, "ManagedVault", [], deployer);
  const committedImpl = await ensure(config, "CommittedVault", [], deployer);

  const factory = await ensure(
    config,
    "CloneFactory",
    [basketImpl, managedImpl, committedImpl],
    deployer,
  );

  console.log(`\n✅ L1 ready. Factory: ${EXPLORER}${factory}\n`);
  return { basketImpl, managedImpl, committedImpl, factory };
}

if (require.main === module) {
  deployL1().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
