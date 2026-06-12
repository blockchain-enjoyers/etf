import { Injectable, NotFoundException } from "@nestjs/common";
import { erc20Abi } from "viem";
import { ManagedRebalanceVaultAbi, PriceAggregatorAbi } from "@meridian/contracts";
import type { RebalanceDetail, KeeperStatus, RebalanceHistory } from "@meridian/sdk";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { KeeperModuleReader } from "../contracts/keeper-module.reader.js";
import { RebalanceModuleReader } from "../contracts/rebalance-module.reader.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { PayloadSignerService } from "../chain/payload-signer.service.js";

const BPS = 10_000n;

@Injectable()
export class RebalanceService {
  constructor(
    private readonly repo: IndexerRepository,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly keeper: KeeperModuleReader,
    private readonly chain: ChainService,
    private readonly prisma: PrismaService,
    private readonly registry: CapabilityRegistry,
    private readonly rebModule: RebalanceModuleReader,
    private readonly signer: PayloadSignerService,
  ) {}

  async getRebalanceDetail(vault: string): Promise<RebalanceDetail> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      include: { constituents: true },
    });
    if (!basket) throw new NotFoundException(`basket ${vault} not found`);

    const held = await this.rebVault.heldTokens(vault as `0x${string}`);

    // Prefer vault.holdingsOf(token) — correct for registry vaults (ERC-6909 backing).
    // holdingsOf was added after current deployment; fall back to ERC20 balanceOf per token
    // when the vault reverts (pre-seam deployment where holdingsOf == balanceOf anyway).
    const holdingsResults = await this.chain.publicClient.multicall({
      allowFailure: true,
      contracts: held.map((token) => ({
        address: vault as `0x${string}`,
        abi: ManagedRebalanceVaultAbi,
        functionName: "holdingsOf" as const,
        args: [token as `0x${string}`],
      })),
    });

    const heldTokens = await Promise.all(
      held.map(async (token, i) => {
        const hr = holdingsResults[i];
        if (hr?.status === "success") {
          return { token, balance: (hr.result as bigint).toString() };
        }
        // holdingsOf unavailable on this vault — fall back to ERC20 balanceOf.
        const balance = (await this.chain.publicClient.readContract({
          address: token as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [vault as `0x${string}`],
        })) as bigint;
        return { token, balance: balance.toString() };
      }),
    );

    const pending = await this.repo.getLatestPendingTarget(vault);
    const pendingTarget = pending
      ? {
          tokens: (pending.tokens as string[]).map((token, i) => ({
            token,
            unitQty: String((pending.unitQty as string[])[i]),
          })),
          effectiveAtMs: pending.effectiveAt ? pending.effectiveAt.getTime() : 0,
        }
      : null;

    const target = basket.constituents.map((c) => ({
      token: c.token,
      unitQty: c.unitQty.toFixed(0),
    }));

    return {
      vaultAddress: vault,
      heldTokens,
      target,
      pendingTarget,
      lastRebalanceAtMs: await this.repo.getLastRebalanceAt(vault),
      totalSupply: (await this.rebVault.totalSupply(vault as `0x${string}`)).toString(),
      drift: await this.computeDrift(vault as `0x${string}`, target, heldTokens),
    };
  }

  /**
   * Decision-only drift estimate (NEVER used to gate settlement; IRON RULE: a closed-market
   * estimate is never a settlement price). Weights each token by its L4 PriceAggregator price.
   * Any missing price, zero total, or read error → null (no drift signal rather than a wrong one).
   */
  private async computeDrift(
    vault: `0x${string}`,
    target: { token: string; unitQty: string }[],
    heldTokens: { token: string; balance: string }[],
  ): Promise<RebalanceDetail["drift"]> {
    try {
      const agg = this.registry.address("PriceAggregator");
      if (!agg) return null;

      const heldBalance = new Map<string, bigint>(
        heldTokens.map((h) => [h.token.toLowerCase(), BigInt(h.balance)]),
      );
      const targetQty = new Map<string, bigint>(
        target.map((t) => [t.token.toLowerCase(), BigInt(t.unitQty)]),
      );
      const tokens = Array.from(
        new Set([...heldBalance.keys(), ...targetQty.keys()]),
      ) as `0x${string}`[];

      const price = new Map<string, bigint>();
      const scale = new Map<string, bigint>();
      for (const token of tokens) {
        const [priceRes, decimals] = await Promise.all([
          (async () => {
            const payloads = await this.signer.payloadsFor(token);
            const { result } = await this.chain.publicClient.simulateContract({
              address: agg,
              abi: PriceAggregatorAbi,
              functionName: "priceOf",
              args: [token, payloads as `0x${string}`[]],
              account: this.chain.account ?? "0x0000000000000000000000000000000000000001",
            });
            return result;
          })(),
          this.chain.publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "decimals",
          }) as Promise<number>,
        ]);
        price.set(token.toLowerCase(), priceRes.price);
        scale.set(token.toLowerCase(), 10n ** BigInt(decimals));
      }

      // value_i = qty_i * price_i / 10^decimals_i (price is 18-dec USD per WHOLE token).
      const valueOf = (qty: bigint, key: string): bigint => {
        const p = price.get(key) ?? 0n;
        const s = scale.get(key) ?? 1n;
        return (qty * p) / s;
      };

      let sumCurrent = 0n;
      let sumTarget = 0n;
      for (const token of tokens) {
        const key = token.toLowerCase();
        sumCurrent += valueOf(heldBalance.get(key) ?? 0n, key);
        sumTarget += valueOf(targetQty.get(key) ?? 0n, key);
      }
      if (sumCurrent === 0n || sumTarget === 0n) return null;

      const items = target.map((t) => {
        const key = t.token.toLowerCase();
        const current = valueOf(heldBalance.get(key) ?? 0n, key);
        const tgt = valueOf(targetQty.get(key) ?? 0n, key);
        const currentWeightBps = (current * BPS) / sumCurrent;
        const targetWeightBps = (tgt * BPS) / sumTarget;
        return { token: t.token, driftBps: Number(currentWeightBps - targetWeightBps) };
      });

      const maxAbs = items.reduce((m, i) => Math.max(m, Math.abs(i.driftBps)), 0);
      const triggerBandBps = await this.rebModule.triggerBandBps();
      const isDue = triggerBandBps > 0 && maxAbs > triggerBandBps;
      return { isDue, triggerBandBps, items };
    } catch {
      return null;
    }
  }

  async getKeeperStatus(vault: string): Promise<KeeperStatus> {
    const escrow = await this.keeper.escrowOf(vault as `0x${string}`);
    const payouts = await this.repo.getKeeperPayouts(vault);
    return {
      escrow: escrow.toString(),
      keeperBps: await this.rebVault.keeperBps(vault as `0x${string}`),
      payouts: payouts.map((p) => ({
        to: p.to,
        amount: p.amount.toFixed(0),
        txHash: p.txHash,
        timestampMs: p.timestamp.getTime(),
      })),
    };
  }

  async getRebalanceHistory(vault: string): Promise<RebalanceHistory> {
    const rows = await this.repo.getRebalanceHistory(vault);
    return {
      items: rows.map((r) => ({
        txHash: r.txHash,
        blockNumber: Number(r.blockNumber),
        recipient: r.recipient,
        acquire: (r.acquire as string[]).map((token, i) => ({
          token,
          amount: String((r.acquireIn as string[])[i]),
        })),
        release: (r.release as string[]).map((token, i) => ({
          token,
          amount: String((r.releaseOut as string[])[i]),
        })),
        timestampMs: r.timestamp.getTime(),
      })),
    };
  }
}
