// Deploy BasketFactory (Meridian L1) to a configured network and record the address.
//
//   npx hardhat run scripts/deploy-factory.ts --network robinhoodTestnet
//
// The factory has no constructor args. After deploy, the address + tx metadata are written
// back into config/testnet.json under deployments.BasketFactory so the backend/scripts can
// read it without parsing logs. Secrets come from .env (see hardhat.config.ts loader).
import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = join(__dirname, "..", "config", "testnet.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No signer — set PRIVATE_KEY in blockchain/.env");
  }

  const addr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(addr);
  console.log(`Network:   ${network.name} (chainId ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`Deployer:  ${addr}`);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(`Deployer ${addr} has 0 balance — fund it from the testnet faucet first.`);
  }

  console.log("Deploying BasketFactory...");
  const Factory = await ethers.getContractFactory("BasketFactory");
  const factory = await Factory.deploy();
  const tx = factory.deploymentTransaction();
  await factory.waitForDeployment();

  const factoryAddr = await factory.getAddress();
  const receipt = tx ? await tx.wait() : null;
  console.log(`\n✅ BasketFactory deployed: ${factoryAddr}`);
  console.log(`   tx:    ${tx?.hash ?? "(unknown)"}`);
  console.log(`   block: ${receipt?.blockNumber ?? "(unknown)"}`);

  // Persist into config/testnet.json (non-secret metadata only).
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  config.deployments ??= {};
  config.deployments.BasketFactory = {
    address: factoryAddr,
    deployer: addr,
    txHash: tx?.hash ?? null,
    block: receipt?.blockNumber ?? null,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`\nWrote address to ${CONFIG_PATH}`);
  console.log(`Explorer: https://explorer.testnet.chain.robinhood.com/address/${factoryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
