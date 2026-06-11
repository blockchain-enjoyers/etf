import { expect } from "chai";
import { ethers } from "hardhat";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

describe("Deploy smoke — full stack wires end-to-end", () => {
  it("deploy-all + deploy-l5 produce a settler-wired registry queue that verify-l5 accepts", async () => {
    const cfgPath = join("/tmp", `meridian-smoke-${Date.now()}.json`);
    writeFileSync(cfgPath, JSON.stringify({ networkName: "hardhat", chainId: 31337, deployments: {} }));
    process.env.DEPLOY_CONFIG = cfgPath;
    process.env.REDEPLOY = "1";

    const { deployL1 } = await import("../../scripts/deploy/deploy-l1");
    const { deployL4 } = await import("../../scripts/deploy/deploy-l4");
    const { deployL3 } = await import("../../scripts/deploy/deploy-l3");
    const { deployDemoStocks } = await import("../../scripts/deploy/deploy-demo-stocks");
    const { deployL5 } = await import("../../scripts/deploy/deploy-l5");
    const { verifyL5 } = await import("../../scripts/deploy/verify-l5");

    await deployL1();
    await deployL4();
    await deployL3();
    await deployDemoStocks();
    const { vault, queue } = await deployL5();

    const v = await ethers.getContractAt("RegistryRebalanceVault", vault);
    expect(await v.totalSupply()).to.be.greaterThan(0n);
    expect((await v.heldTokens()).length).to.equal(3);
    expect(await v.isSettler(queue)).to.equal(true);
    const q = await ethers.getContractAt("ForwardCashQueue", queue);
    expect(await q.isRegistry()).to.equal(true);

    await verifyL5(); // throws if any acceptance check fails

    delete process.env.DEPLOY_CONFIG;
    delete process.env.REDEPLOY;
  });
});
