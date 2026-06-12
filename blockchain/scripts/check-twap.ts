import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./deploy/_shared";
async function main() {
  const config = loadConfig();
  const nav = await ethers.getContractAt("BasketNavObserver", requireAddress(config, "BasketNavObserver", "x"));
  const vault = requireAddress(config, "RebalanceVaultDemo", "x");
  for (const win of [60n, 3600n, 604800n]) {
    try {
      const [twap, count] = await nav.consult.staticCall(vault, win);
      console.log(`consult(win=${win}): twap=$${ethers.formatUnits(twap, 18)} count=${count}`);
    } catch (e: any) {
      const data = e?.data ?? e?.info?.error?.data ?? "<none>";
      let name = "?";
      try { name = nav.interface.parseError(data)?.name ?? "?"; } catch {}
      console.log(`consult(win=${win}) REVERT data=${data} decoded=${name}`);
    }
  }
}
main().catch((e) => { console.error(e.message?.slice(0,150)); process.exitCode = 1; });
