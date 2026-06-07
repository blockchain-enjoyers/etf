// DEPRECATED — the factory was renamed BasketFactory -> CloneFactory and now deploys three vault
// implementations behind EIP-1167 clones. This shim forwards to the layered deploy under
// scripts/deploy/. Use that directly:
//
//   npx hardhat run scripts/deploy/deploy-l1.ts  --network robinhoodTestnet   # impls + CloneFactory
//   npx hardhat run scripts/deploy/deploy-all.ts --network robinhoodTestnet   # full L1-L4 stack
import { deployL1 } from "./deploy/deploy-l1";

deployL1().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
