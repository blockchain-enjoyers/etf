// READ-ONLY: check whether deployed L4 bytecode contains the newer selectors.
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./deploy/_shared";

function sel(sig: string) { return ethers.id(sig).slice(2, 10); }

async function main() {
  const c = loadConfig();
  const nav = requireAddress(c, "FairValueNAV", "x");
  const agg = requireAddress(c, "PriceAggregator", "x");
  const navCode = await ethers.provider.getCode(nav);
  const aggCode = await ethers.provider.getCode(agg);

  const checks: [string, string, string][] = [
    [nav === navCode ? "" : "FairValueNAV", "navOfHoldings(address,address[],bytes[][])", navCode],
    ["FairValueNAV", "navOf(address,address[],uint256[],bytes[][])", navCode],
    ["FairValueNAV", "acceptedDepthOf(address,bytes[])", navCode],
    ["PriceAggregator", "isSource(address,address)", aggCode],
    ["PriceAggregator", "priceOf(address,bytes[])", aggCode],
    ["PriceAggregator", "acceptedDepthOf(address,bytes[])", aggCode],
  ];
  for (const [who, sig, code] of checks) {
    const s = sel(sig);
    console.log(`${(who || "FairValueNAV").padEnd(16)} ${sig.padEnd(48)} sel=0x${s} present=${code.includes(s)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
