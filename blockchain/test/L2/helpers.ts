import { ethers } from "hardhat";

// Shared constants for the L2 read-price stack tests (ChainlinkAdapter / OracleRouter / NAVEngine).

export const ONE = 10n ** 18n; // 1e18 price scale + 18-dec token unit
export const E6 = 10n ** 6n; // a 6-dec cash leg, to exercise decimals normalization
export const HOUR = 3600;

// Our MarketStatus enum (OracleTypes.sol), declared in ascending severity.
export const Status = { Open: 0n, Degraded: 1n, Halted: 2n, Closed: 3n, Unknown: 4n };

// Vendor marketStatus codes.
export const V11 = { Unknown: 0, Pre: 1, Regular: 2, Post: 3, Overnight: 4, Closed: 5 };
export const V8 = { Unknown: 0, Closed: 1, Open: 2 };

export const coder = ethers.AbiCoder.defaultAbiCoder();

// In tests the "signed report" is simplified to abi.encode(feedId) — the mock verifier returns the
// report stored under that feedId. The adapter under test is real (forwards + decodes + validates).
export const payloadFor = (feedId: string) => coder.encode(["bytes32"], [feedId]);

export const ns = (tsSec: number | bigint) => BigInt(tsSec) * 10n ** 9n;
