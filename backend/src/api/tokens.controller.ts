import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { erc20Abi } from "viem";
import { demoTokens } from "@meridian/contracts";
import type { TokenInfo, TokenBalance } from "@meridian/sdk";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { ChainService } from "../chain/chain.service.js";

const CATALOG = new Map(demoTokens.map((t) => [t.address.toLowerCase(), t]));

// Mock Stock faucet surface: a fixed-amount, per-address-capped open mint. Reads are best-effort —
// a token without these (a real ERC-20) just reports no faucet.
const faucetAbi = [
  { type: "function", name: "FAUCET_AMOUNT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "FAUCET_CAP", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "faucetMinted", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

@Controller("tokens")
export class TokensController {
  constructor(
    private readonly meta: TokenMetadataService,
    private readonly chain: ChainService,
  ) {}

  @Get("search")
  search(@Query("q") q?: string): TokenInfo[] {
    const needle = (q ?? "").trim().toLowerCase();
    if (!needle) return [];
    return demoTokens
      .filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
      .slice(0, 20)
      .map((t) => ({ token: t.address, symbol: t.symbol, name: t.name }));
  }

  @Post("resolve")
  async resolve(@Body() body: { addresses: string[] }): Promise<TokenInfo[]> {
    const addrs = (body.addresses ?? []).map((a) => a.toLowerCase());
    const missing = addrs.filter((a) => !CATALOG.has(a));
    const onchain = missing.length ? await this.meta.getMany(missing) : {};
    return addrs.map((a) => {
      const hit = CATALOG.get(a);
      if (hit) return { token: hit.address, symbol: hit.symbol, name: hit.name };
      const m = onchain[a];
      return { token: a, symbol: m?.symbol ?? a.slice(0, 6), name: m?.name ?? null };
    });
  }

  // Per-token wallet balance + (for mock Stocks) how much of the faucet cap is still available. Drives
  // the FE in-kind funding check: short on a constituent ⇒ offer to faucet-mint it before minting.
  @Post("balances")
  async balances(@Body() body: { account: string; tokens: string[] }): Promise<TokenBalance[]> {
    const account = (body.account ?? "") as `0x${string}`;
    const tokens = (body.tokens ?? []) as `0x${string}`[];
    if (!account || tokens.length === 0) return [];
    const meta = await this.meta.getMany(tokens);

    return Promise.all(
      tokens.map(async (token) => {
        const m = meta[token.toLowerCase()] ?? { symbol: token.slice(0, 6), decimals: 18 };
        const [balance, faucetInfo] = await Promise.all([
          this.balanceOf(token, account),
          this.faucetInfo(token, account),
        ]);
        return {
          token,
          symbol: m.symbol,
          decimals: m.decimals,
          balance: balance.toString(),
          faucetAmount: faucetInfo ? faucetInfo.amount.toString() : null,
          faucetRemaining: faucetInfo ? faucetInfo.remaining.toString() : null,
        };
      }),
    );
  }

  private async balanceOf(token: `0x${string}`, account: `0x${string}`): Promise<bigint> {
    try {
      return (await this.chain.publicClient.readContract({
        address: token, abi: erc20Abi, functionName: "balanceOf", args: [account],
      })) as bigint;
    } catch {
      return 0n;
    }
  }

  private async faucetInfo(token: `0x${string}`, account: `0x${string}`): Promise<{ amount: bigint; remaining: bigint } | null> {
    try {
      const [amount, cap, minted] = await Promise.all([
        this.chain.publicClient.readContract({ address: token, abi: faucetAbi, functionName: "FAUCET_AMOUNT" }) as Promise<bigint>,
        this.chain.publicClient.readContract({ address: token, abi: faucetAbi, functionName: "FAUCET_CAP" }) as Promise<bigint>,
        this.chain.publicClient.readContract({ address: token, abi: faucetAbi, functionName: "faucetMinted", args: [account] }) as Promise<bigint>,
      ]);
      const remaining = cap > minted ? cap - minted : 0n;
      return { amount, remaining };
    } catch {
      return null; // not a faucet token (real ERC-20 / no faucet getters)
    }
  }
}
