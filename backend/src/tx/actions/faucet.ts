import { encodeFunctionData } from "viem";
import type { ActionResult, BuiltStep } from "../action-registry.js";

// The colleague's mock Stock exposes a no-arg, per-address-capped faucet that mints a fixed amount to
// the caller. No args ⇒ no mint(uint256.max) vector; the only safety surface is the destination token.
const faucetAbi = [
  { type: "function", name: "faucetMint", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

// Demo USDG (MockERC20Decimals) has an OPEN mint(to, amount) — no faucetMint/cap. Fixed per-click amount
// so the cash-create funding check can top a wallet up like the Stock faucet. 18-dec USDG.
export const USDG_FAUCET_AMOUNT = 100n * 10n ** 18n;
const mintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
  },
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

/** Single-step plan: open-mint a fixed amount of demo USDG to the caller (funds forward-cash flows). */
export function buildUsdgFaucet(token: string, account: string, amount = USDG_FAUCET_AMOUNT): ActionResult {
  const data = encodeFunctionData({
    abi: mintAbi,
    functionName: "mint",
    args: [account as `0x${string}`, amount],
  });
  const call: BuiltStep = {
    kind: "call",
    to: token as `0x${string}`,
    data,
    value: "0",
    contractName: "USDG",
    label: "Mint test USDG",
    summary: "Faucet-mint demo USDG to your wallet",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}
