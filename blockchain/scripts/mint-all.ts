// Mint 1 unit into each non-registry vault so they show a non-zero TOTAL NAV. Uses the BACKEND's
// /tx/mint to build the exact calldata (deposits + createArg + flat-fee USDG approve), then sends the
// steps with the deployer. Mints stocks + USDG to the deployer first. Backend must be running on :3000.
// Run: npx hardhat run scripts/mint-all.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig } from "./deploy/_shared";

const API = "http://localhost:3000";
const ONE = 10n ** 18n;
const VAULTS: Record<string, string> = {
  static: "0x42EADF433673A8Dc0C82A24d644cD293e6215794",
  committed: "0x2A7643803984Af565ebBc627fd370E5b6F852F5f",
  managed: "0x14AEEC8e751081dd95d3D691668657584AFA6D43",
  rebalance: "0xF2D07e33a0191DfC091f8a88a9120D33D145AeF0",
};

async function main() {
  const c = loadConfig();
  const D = c.deployments!;
  const [signer] = await ethers.getSigners();
  const me = signer.address;

  console.log("== mint stocks + USDG to deployer ==");
  for (const key of ["Stock_MSTRx", "Stock_TSLAx", "Stock_NVDAx", "USDG"]) {
    const t = await ethers.getContractAt("MockERC20Decimals", D[key].address);
    await (await t.mint(me, 100n * ONE)).wait();
    console.log(`  +100e18 ${key}`);
  }

  console.log("== mint 1 unit per vault (via backend calldata) ==");
  for (const [name, vault] of Object.entries(VAULTS)) {
    try {
      const res = await fetch(`${API}/baskets/${vault}/tx/mint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: me, units: "1", mode: "approve" }),
      });
      if (!res.ok) {
        console.log(`  !! ${name.padEnd(10)} mint-plan HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
        continue;
      }
      const plan = (await res.json()) as { gate?: { gated: boolean; reason: string }; steps: { kind: string; to: string; data: string; value?: string }[] };
      if (plan.gate?.gated) {
        console.log(`  !! ${name.padEnd(10)} gated: ${plan.gate.reason}`);
        continue;
      }
      let n = 0;
      for (const step of plan.steps) {
        if (step.kind === "sign712") {
          console.log(`  !! ${name.padEnd(10)} unexpected permit step (skip)`);
          continue;
        }
        const tx = await signer.sendTransaction({ to: step.to, data: step.data as `0x${string}`, value: BigInt(step.value || "0") });
        await tx.wait();
        n++;
      }
      console.log(`  OK ${name.padEnd(10)} minted 1 unit (${n} steps)`);
    } catch (e: any) {
      console.log(`  !! ${name.padEnd(10)} ${(e?.shortMessage || e?.message || e).toString().slice(0, 120)}`);
    }
  }
  console.log("\nregistry (already bootstrapped, NAV live): 0x3F78db0F384e4bf325809F0f417ef4Afa76B2E4F");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
