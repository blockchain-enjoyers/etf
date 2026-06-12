import { Injectable, NotFoundException } from "@nestjs/common";
import { erc20Abi } from "viem";
import { ManagedRebalanceVaultAbi } from "@meridian/contracts";
import type { HoldingsResponse, HoldingRow } from "@meridian/sdk";
import { PrismaService } from "../persistence/prisma.service.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";

const BPS = 10_000n;

@Injectable()
export class HoldingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: TokenMetadataService,
    private readonly chain: ChainService,
    private readonly rebVault: ManagedRebalanceVaultReader,
  ) {}

  async getHoldings(vault: string): Promise<HoldingsResponse> {
    const basket = await this.prisma.basket.findUnique({ where: { vaultAddress: vault }, include: { constituents: true } });
    if (!basket) throw new NotFoundException(`basket ${vault} not found`);
    const nav = await this.prisma.navSnapshot.findFirst({ where: { vaultAddress: vault }, orderBy: { timestamp: "desc" } });
    const meta = await this.meta.getMany(basket.constituents.map((c) => c.token));

    const rows = await Promise.all(basket.constituents.map(async (c) => {
      const key = c.token.toLowerCase();
      const m = meta[key]!;
      const snap = await this.prisma.priceSnapshot.findFirst({ where: { token: c.token }, orderBy: { timestamp: "desc" } });
      const price = snap ? BigInt(snap.price.toFixed(0)) : 0n;
      const qty = BigInt(c.unitQty.toFixed(0));
      const value = (qty * price) / 10n ** BigInt(m.decimals);
      return { token: c.token, m, qty, price, value, estimated: snap ? snap.marketStatus !== "Regular" : true };
    }));

    const sum = rows.reduce((s, r) => s + r.value, 0n);

    // For rebalance vaults, try to compute real current weights from held balances.
    let heldValueMap: Map<string, bigint> | null = null;
    let heldSum = 0n;
    if (basket.vaultType === "Rebalance") {
      try {
        const held = await this.rebVault.heldTokens(vault as `0x${string}`);

        // Prefer vault.holdingsOf(token) — correct for registry vaults (ERC-6909 backing).
        // holdingsOf was added after current deployment, so we allowFailure and fall back to
        // ERC20 balanceOf for any token where the vault reverts (pre-seam deployment).
        const holdingsResults = await this.chain.publicClient.multicall({
          allowFailure: true,
          contracts: held.map((token) => ({
            address: vault as `0x${string}`,
            abi: ManagedRebalanceVaultAbi,
            functionName: "holdingsOf" as const,
            args: [token],
          })),
        });

        // Collect indices where holdingsOf reverted so we can fall back to balanceOf.
        const fallbackIndices: number[] = [];
        for (let i = 0; i < held.length; i++) {
          if (holdingsResults[i]?.status !== "success") fallbackIndices.push(i);
        }

        type MulticallEntry = { status: "success"; result: unknown } | { status: "failure"; error: unknown };
        let balanceFallbacks: MulticallEntry[] = [];
        if (fallbackIndices.length > 0) {
          balanceFallbacks = (await this.chain.publicClient.multicall({
            allowFailure: true,
            contracts: fallbackIndices.map((i) => ({
              address: held[i]! as `0x${string}`,
              abi: erc20Abi,
              functionName: "balanceOf" as const,
              args: [vault as `0x${string}`],
            })),
          })) as MulticallEntry[];
        }

        const heldMap = new Map<string, bigint>();
        let fallbackCursor = 0;
        for (let i = 0; i < held.length; i++) {
          const hr = holdingsResults[i];
          if (hr?.status === "success") {
            heldMap.set(held[i]!.toLowerCase(), hr.result as bigint);
          } else {
            const br = balanceFallbacks[fallbackCursor++];
            heldMap.set(held[i]!.toLowerCase(), br?.status === "success" ? (br.result as bigint) : 0n);
          }
        }
        // Value each PCF constituent by its held balance and price snapshot.
        const heldValues = rows.map((r) => {
          const bal = heldMap.get(r.token.toLowerCase()) ?? 0n;
          return (bal * r.price) / 10n ** BigInt(r.m.decimals);
        });
        heldSum = heldValues.reduce((s, v) => s + v, 0n);
        if (heldSum > 0n) {
          heldValueMap = new Map(rows.map((r, i) => [r.token.toLowerCase(), heldValues[i]!]));
        }
      } catch {
        // Fall back to current == target (drift 0).
      }
    }

    const holdings: HoldingRow[] = rows.map((r) => {
      const targetWeightBps = sum > 0n ? Number((r.value * BPS) / sum) : 0;
      let currentWeightBps: number;
      if (heldValueMap !== null) {
        const hv = heldValueMap.get(r.token.toLowerCase()) ?? 0n;
        currentWeightBps = Number((hv * BPS) / heldSum);
      } else {
        currentWeightBps = targetWeightBps;
      }
      return {
        token: r.token, symbol: r.m.symbol, name: r.m.name, decimals: r.m.decimals,
        qtyPerUnit: r.qty.toString(), priceUsd: r.price.toString(), valuePerUnitUsd: r.value.toString(),
        currentWeightBps, targetWeightBps, driftBps: currentWeightBps - targetWeightBps, estimated: r.estimated,
      };
    });
    return {
      vaultAddress: vault,
      navPerUnit: nav ? nav.nav.toFixed(0) : "0",
      estimated: nav ? nav.estimated : true,
      timestampMs: nav ? nav.timestamp.getTime() : 0,
      holdings,
    };
  }
}
