import { ethers } from "hardhat";

// Deploy the shared Stock implementation (its constructor binds the AccessControlsRegistry).
export async function deployStockImpl(registryAddr: string): Promise<string> {
  const Stock = await ethers.getContractFactory("Stock");
  const impl = await Stock.deploy(registryAddr);
  await impl.waitForDeployment();
  return impl.getAddress();
}

// Deploy the StockCloneFactory (once). It clones+initializes a Stock impl in one cheap tx.
export async function deployStockCloneFactory(): Promise<string> {
  const F = await ethers.getContractFactory("StockCloneFactory");
  const f = await F.deploy();
  await f.waitForDeployment();
  return f.getAddress();
}

// Deploy one Stock as an EIP-1167 clone via the factory; returns the clone address (parsed from the event).
export async function deployStockClone(
  factoryAddr: string, implAddr: string, name: string, symbol: string,
): Promise<string> {
  if (Buffer.byteLength(symbol) > 31) throw new Error(`symbol too long for bytes32: ${symbol}`);
  const f = await ethers.getContractAt("StockCloneFactory", factoryAddr);
  const uid = ethers.encodeBytes32String(symbol);
  const rc = await (await f.create(implAddr, uid, name, symbol)).wait();
  for (const log of rc!.logs) {
    try { const p = f.interface.parseLog(log as any); if (p?.name === "StockCreated") return p.args.stock as string; }
    catch { /* not our event */ }
  }
  throw new Error("deployStockClone: StockCreated event not found");
}
