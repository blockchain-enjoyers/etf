import { encodeFunctionData } from "viem";
import type { ActionResult, BuiltStep } from "../action-registry.js";

// The colleague's mock Stock exposes a no-arg, per-address-capped faucet that mints a fixed amount to
// the caller. No args ⇒ no mint(uint256.max) vector; the only safety surface is the destination token.
const faucetAbi = [
  { type: "function", name: "faucetMint", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

/** Single-step plan: faucet-mint the demo Stock token to the caller (used to fund in-kind flows). */
export function buildFaucet(token: string, symbol?: string): ActionResult {
  const data = encodeFunctionData({ abi: faucetAbi, functionName: "faucetMint" });
  const call: BuiltStep = {
    kind: "call",
    to: token as `0x${string}`,
    data,
    value: "0",
    contractName: "Stock",
    label: `Mint test ${symbol ?? "tokens"}`,
    summary: `Faucet-mint demo ${symbol ?? "tokens"} to your wallet`,
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}
