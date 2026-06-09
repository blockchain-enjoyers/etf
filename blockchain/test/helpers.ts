import { ethers } from "hardhat";

export const ONE = 10n ** 18n;
export const MINTER_ROLE = ethers.id("MINTER_ROLE");
export const MULTIPLIER_UPDATER_ROLE = ethers.id("MULTIPLIER_UPDATER_ROLE");
export const TOKEN_PAUSER_ROLE = ethers.id("TOKEN_PAUSER_ROLE");

// Deploy the test AccessControlsRegistry with `admin` holding DEFAULT_ADMIN_ROLE.
export async function deployRegistry(admin: string) {
  const Reg = await ethers.getContractFactory("AccessControlsRegistry");
  const registry = await Reg.deploy(admin);
  await registry.waitForDeployment();
  return registry;
}

// Deploy an upgradeable Stock behind an ERC1967 proxy, initialized with name/symbol.
// `registry` must already grant MINTER_ROLE to whoever will call stock.mint().
export async function deployStock(registry: any, name: string, symbol: string) {
  const Stock = await ethers.getContractFactory("Stock");
  const impl = await Stock.deploy(await registry.getAddress());
  await impl.waitForDeployment();

  const initData = Stock.interface.encodeFunctionData("initialize", [
    ethers.encodeBytes32String(symbol),
    name,
    symbol,
  ]);

  const Proxy = await ethers.getContractFactory("StockProxy");
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();

  return Stock.attach(await proxy.getAddress());
}

// Sign an EIP-2612 permit for `token` from `owner` to `spender`. Returns a PermitInput-shaped object.
export async function signPermit(
  token: any,
  owner: any,
  spender: string,
  value: bigint,
  deadline: bigint
) {
  const name = await token.name();
  const nonce = await token.nonces(owner.address);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const domain = { name, version: "1", chainId, verifyingContract: await token.getAddress() };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const message = { owner: owner.address, spender, value, nonce, deadline };
  const sig = ethers.Signature.from(await owner.signTypedData(domain, types, message));
  return { value, deadline, v: sig.v, r: sig.r, s: sig.s };
}

// A "skip this leg" PermitInput (deadline == 0): used when a constituent lacks permit or was approved classically.
export const SKIP_PERMIT = { value: 0n, deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash };

// Whole shares the contract mints to ONE fee leg over `elapsed` seconds on `supply` at annual `bps`.
// Mirrors _feeAddScaled (×SCALE) then floors by /SCALE. SCALE == 1e18.
export function expectedFeeShares(supply: bigint, bps: bigint, elapsed: bigint, accOwed: bigint = 0n): bigint {
  const BPS = 10_000n, YEAR = 365n * 24n * 60n * 60n, SCALE = 10n ** 18n;
  const num = bps * elapsed, den = BPS * YEAR;
  const addScaled = num >= den ? supply * SCALE : (supply * num * SCALE) / (den - num); // mulDiv floor
  return (accOwed + addScaled) / SCALE;
}

export type Leg = { stock: any; addr: string; qty: bigint };

// The vault constructor requires strictly ascending token addresses; sort the recipe to match.
export function sortRecipe(legs: Leg[]): Leg[] {
  return [...legs].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
}
