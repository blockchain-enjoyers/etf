import { ethers } from "hardhat";

export const ONE = 10n ** 18n;
export const HOUR = 3600;

// L2 OracleTypes.MarketStatus (ascending severity), reused by L4.
export const Status = { Open: 0n, Degraded: 1n, Halted: 2n, Closed: 3n, Unknown: 4n };
export const Kind = { AMM_SPOT: 0, AMM_TWAP: 1, PERP: 2, ORACLE_PUSH: 3, ORACLE_PULL: 4, RWA_STREAM: 5 };

export const usd = (n: number | bigint) => BigInt(n) * ONE;
export const EMPTY = "0x";

export async function deployMock() {
  const Mock = await ethers.getContractFactory("MockSource");
  return Mock.deploy();
}
