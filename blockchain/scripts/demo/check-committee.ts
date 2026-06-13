import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "../deploy/_shared";
async function main() {
  const c = loadConfig();
  const wd = requireAddress(c, "UniversalSignedSource", "x");
  const we = requireAddress(c, "UniversalSignedSourceWeekend", "x");
  const deployer = "0xb1Ce525A223DB37BbbC5636D1dd70f7bfeF6e3cD";
  const colleague = "0x1bCC28037Ee100818857F7da936EF1bD39E84639";
  for (const [name, addr] of [["weekday", wd], ["weekend", we]] as const) {
    const s = await ethers.getContractAt("UniversalSignedSource", addr);
    const th = await s.threshold().catch(() => "n/a");
    const d = await s.isCommittee(deployer).catch((e:any)=>"err:"+e.shortMessage);
    const co = await s.isCommittee(colleague).catch((e:any)=>"err:"+e.shortMessage);
    console.log(`${name} ${addr} threshold=${th} isCommittee[deployer 0xb1Ce]=${d} isCommittee[0x1bCC]=${co}`);
  }
}
main().catch((e)=>{console.error(e);process.exitCode=1;});
