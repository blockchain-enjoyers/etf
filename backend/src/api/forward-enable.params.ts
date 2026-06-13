import { keccak256, encodeAbiParameters } from "viem";

export interface EnableParams {
  minPrints: number;
  twapWindowSec: number;
  twapBandBps: number;
  pegBandBps: number;
  pegMaxAgeSec: number;
  cutoffDelaySec: number;
  spreadBps: number;
  capacityBps: number;
  keeperTip: string;
  keeperBps: number;
}

const CAPS = {
  minPrints: [2, 1000],
  twapWindowSec: [60, 86400],
  twapBandBps: [10, 2000],
  pegBandBps: [10, 2000],
  pegMaxAgeSec: [60, 86400],
  cutoffDelaySec: [600, 604800],
  spreadBps: [0, 200],
  capacityBps: [0, 10000],
  keeperBps: [0, 2000],
} as const;

const KEEPER_TIP_MAX = 100n * 10n ** 18n;

export function validateEnableParams(p: EnableParams): { ok: true } | { ok: false; field: string } {
  for (const k of Object.keys(CAPS) as (keyof typeof CAPS)[]) {
    const v = p[k] as number;
    const [lo, hi] = CAPS[k];
    if (!Number.isInteger(v) || v < lo || v > hi) return { ok: false, field: k };
  }
  let tip: bigint;
  try {
    tip = BigInt(p.keeperTip);
  } catch {
    return { ok: false, field: "keeperTip" };
  }
  if (tip < 0n || tip > KEEPER_TIP_MAX) return { ok: false, field: "keeperTip" };
  return { ok: true };
}

const PARAMS_ABI = Array.from({ length: 10 }, () => ({ type: "uint256" as const }));

export function paramsHashOf(p: EnableParams): `0x${string}` {
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
