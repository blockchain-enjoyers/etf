import { keccak256, encodeAbiParameters } from "viem";
import type { EnableParams } from "./dto.js";

const PARAMS_ABI = Array.from({ length: 10 }, () => ({ type: "uint256" as const }));

export function paramsHash(p: EnableParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(PARAMS_ABI, [
      BigInt(p.minPrints),
      BigInt(p.twapWindowSec),
      BigInt(p.twapBandBps),
      BigInt(p.pegBandBps),
      BigInt(p.pegMaxAgeSec),
      BigInt(p.cutoffDelaySec),
      BigInt(p.spreadBps),
      BigInt(p.capacityBps),
      BigInt(p.keeperTip),
      BigInt(p.keeperBps),
    ]),
  );
}

export function buildEnableCashSettlementTypedData(
  vault: `0x${string}`,
  params: EnableParams,
  nonce: bigint,
  expiry: bigint,
  chainId: number,
) {
  return {
    domain: { name: "Meridian", version: "1", chainId, verifyingContract: vault },
    types: {
      EnableCashSettlement: [
        { name: "vault", type: "address" },
        { name: "paramsHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
      ],
    },
    primaryType: "EnableCashSettlement" as const,
    message: { vault, paramsHash: paramsHash(params), nonce, expiry },
  };
}
