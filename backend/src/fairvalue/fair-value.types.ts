import type { TypedDataDomain } from "viem";

/** Closed-market fair value as produced by the off-chain beta-fitting pipeline (canonical 18-dec). */
export interface FairValue {
  basketId: `0x${string}`;
  nav: bigint;
  lower: bigint;
  upper: bigint;
  /** Unix seconds. */
  timestamp: number;
}

/** A FairValue plus the signer + signature, after wire-decode (string → bigint). */
export interface SignedFairValue extends FairValue {
  signer: `0x${string}`;
  signature: `0x${string}`;
}

/** EIP-712 types for the fair-value attestation. Mirrors the contract's setFairValueAttestation schema. */
export const FAIR_VALUE_EIP712_TYPES = {
  FairValue: [
    { name: "basketId", type: "bytes32" },
    { name: "nav", type: "uint256" },
    { name: "lower", type: "uint256" },
    { name: "upper", type: "uint256" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

/** Domain separator pinned to the RHC chain + the verifying (oracle) contract. */
export function fairValueDomain(
  chainId: number,
  verifyingContract: `0x${string}`,
): TypedDataDomain {
  return {
    name: "MeridianFairValue",
    version: "1",
    chainId,
    verifyingContract,
  };
}

/** Convert a FairValue into the EIP-712 message shape (all numerics as bigint). */
export function toFairValueMessage(value: FairValue): {
  basketId: `0x${string}`;
  nav: bigint;
  lower: bigint;
  upper: bigint;
  timestamp: bigint;
} {
  return {
    basketId: value.basketId,
    nav: value.nav,
    lower: value.lower,
    upper: value.upper,
    timestamp: BigInt(value.timestamp),
  };
}
