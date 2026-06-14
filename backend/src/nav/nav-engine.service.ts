import { Injectable } from "@nestjs/common";
import { erc20Abi } from "viem";
import { MarketStatus } from "../domain/market-status.js";
import { type NavResult, OracleSource, normalizeTo18 } from "../domain/oracle.js";
import type { NavReading, SignalRouter } from "../signals/signal-router.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { OnChainNavReader, type Recipe } from "./onchain-nav.reader.js";
import { BootstrapBasket } from "./basket-source.js";
import { ConfidenceService } from "./confidence.service.js";
import { catalogPrice18 } from "../contracts/catalog-price.js";

const SCALE = 1_000_000_000_000_000_000n; // 1e18

/**
 * Deterministic NAV drift for the DEMO_NAV path: a per-vault sine wobble (±~1.5%) combining a slow 1h
 * cycle and a faster 5min cycle so the chart visibly moves tick-to-tick. Phase derived from the vault
 * address so vaults decorrelate. Same wall-clock ⇒ same value (replica-safe).
 */
function applyDrift(base: bigint, vault: string): bigint {
  if (base <= 0n) return base;
  const nowSec = Math.floor(Date.now() / 1000);
  const seed = Number.parseInt(vault.slice(-8), 16) || 0;
  const phi1 = (seed % 628) / 100;
  const phi2 = ((seed >> 8) % 628) / 100;
  const bps = Math.round(
    100 * Math.sin((2 * Math.PI * nowSec) / 3600 + phi1) + 50 * Math.sin((2 * Math.PI * nowSec) / 300 + phi2),
  );
  return (base * BigInt(10_000 + bps)) / 10_000n;
}

/**
 * Computes NAV like the L4 contract FairValueNAV.navOf: nav = Σ holdingᵢ·priceᵢ / 1e18,
 * band = Σ holdingᵢ·confidenceᵢ / 1e18, estimated if any constituent is not Regular.
 * When NAV_SOURCE=onchain and FairValueNAV is deployed, delegates to the on-chain L4 reader.
 */
@Injectable()
export class NavEngineService {
  constructor(
    private readonly router: SignalRouter,
    private readonly confidence: ConfidenceService,
    private readonly bootstrap: BootstrapBasket,
    private readonly onchain: OnChainNavReader,
    private readonly prisma: PrismaService,
    private readonly registry: CapabilityRegistry,
    private readonly config: ConfigService,
    private readonly chain: ChainService,
  ) {}

  async computeNav(vaultAddress: string): Promise<NavResult> {
    // Hackathon-only: a living, drifting per-share NAV computed off-chain from the catalog, so charts
    // populate + positions value for EVERY vault without a working on-chain oracle. Temporary.
    if (this.config.get("DEMO_NAV")) {
      return this.computeDemo(vaultAddress);
    }
    if (this.config.get("NAV_SOURCE") === "onchain" && this.registry.present("FairValueNAV")) {
      return this.computeOnChain(vaultAddress as `0x${string}`);
    }
    return this.computeFromSignals(vaultAddress);
  }

  /**
   * DEMO_NAV path: per-share NAV = Σ(unitQty·price)/unitSize from the persisted constituents (catalog
   * price, snapshot fallback), with a deterministic time drift so the chart lives 24/7. Per-share so
   * positionValue = balance·nav/1e18 is correct. Never a settlement price (estimated stays informational).
   */
  private async computeDemo(vault: string): Promise<NavResult> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      include: { constituents: true },
    });
    if (!basket) throw new Error(`NAV: unknown basket ${vault}`);

    // toFixed(0), not toString(): Prisma Decimal.toString() emits scientific notation (e.g. "1e+21")
    // for values >= 1e21, which BigInt() can't parse.
    const unitSize = BigInt(basket.unitSize.toFixed(0));
    let valuePerUnit = 0n; // 18-dec USD value of one creation unit
    for (const c of basket.constituents) {
      const price = await this.demoPrice(c.token);
      valuePerUnit += (BigInt(c.unitQty.toFixed(0)) * price) / SCALE;
    }
    const baseNavPerShare = unitSize > 0n ? (valuePerUnit * SCALE) / unitSize : valuePerUnit;
    const nav = applyDrift(baseNavPerShare, vault);
    const band = nav / 200n; // ±0.5% confidence band

    return {
      nav,
      confidenceLower: nav > band ? nav - band : 0n,
      confidenceUpper: nav + band,
      marketStatus: MarketStatus.Regular,
      source: OracleSource.LastClose,
      estimated: false,
      timestamp: Math.floor(Date.now() / 1000),
      safe: true,
    };
  }

  /** Catalog baseline (always available, deterministic) with a latest-snapshot fallback for off-catalog tokens. */
  private async demoPrice(token: string): Promise<bigint> {
    const cat = catalogPrice18(token);
    if (cat !== undefined) return cat;
    const snap =
      (await this.prisma.priceSnapshot.findFirst({ where: { token }, orderBy: { timestamp: "desc" } })) ??
      (await this.prisma.priceSnapshot.findFirst({ where: { token: token.toLowerCase() }, orderBy: { timestamp: "desc" } }));
    return snap ? BigInt(snap.price.toFixed(0)) : 0n;
  }

  private async computeOnChain(vault: `0x${string}`): Promise<NavResult> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      include: { constituents: true },
    });
    if (!basket) throw new Error(`NAV: unknown basket ${vault}`);

    // Rebalance + Registry are holdings-based (ERC-6909 claim backing for registry); their on-chain
    // "recipe" is a Merkle root, not keccak(tokens,unitQty,unitSize), so navOf would RecipeMismatch.
    if (basket.vaultType === "Rebalance" || basket.vaultType === "Registry") {
      return this.onchain.readL4Holdings(vault);
    }
    // Basket/Managed/Committed: L4 per-unit recipe NAV scaled to total.
    return this.l4Total(vault, basket);
  }

  // L4 returns per-unit value; scale to total via outstanding units = totalSupply / unitSize.
  // NOTE: verify this scaling against the deployed FairValueNAV semantics before production reliance.
  private async l4Total(
    vault: `0x${string}`,
    basket: { unitSize: { toString(): string }; constituents: { token: string; unitQty: { toString(): string } }[] },
  ): Promise<NavResult> {
    const recipe: Recipe = {
      tokens: basket.constituents.map((c) => c.token as `0x${string}`),
      unitQty: basket.constituents.map((c) => BigInt(c.unitQty.toString())),
      unitSize: BigInt(basket.unitSize.toString()),
    };
    const perUnit = await this.onchain.readL4PerUnit(vault, recipe);
    const supply = (await this.chain.publicClient.readContract({
      address: vault,
      abi: erc20Abi,
      functionName: "totalSupply",
    })) as bigint;
    const units = recipe.unitSize === 0n ? 0n : supply / recipe.unitSize;
    const scale = (x: bigint) => x * units;
    return {
      ...perUnit,
      nav: scale(perUnit.nav),
      confidenceLower: scale(perUnit.confidenceLower),
      confidenceUpper: scale(perUnit.confidenceUpper),
    };
  }

  /** Off-chain path: price the configured bootstrap basket from real RHC signals. */
  private async computeFromSignals(basketId: string): Promise<NavResult> {
    const def = this.bootstrap.definition(basketId);
    if (!def) throw new Error(`NAV: unknown basket ${basketId}`);

    let nav = 0n;
    let summedBand = 0n;
    let estimated = false;
    let worstStatus = MarketStatus.Regular;
    let source = OracleSource.Chainlink;
    let timestamp = Math.floor(Date.now() / 1000);

    for (const h of def.holdings) {
      const r: NavReading = await this.router.getReading(h.token);
      const held = normalizeTo18(h.amount, h.decimals);

      nav += (held * r.price) / SCALE;
      summedBand += (held * r.confidence) / SCALE;

      if (r.estimated || r.marketStatus !== MarketStatus.Regular) {
        estimated = true;
        worstStatus = r.marketStatus; // report the (last) non-Regular status
      }
      if (this.sourceRank(r.source) > this.sourceRank(source)) source = r.source;
      timestamp = Math.min(timestamp, r.timestamp || timestamp);
    }

    const { lower, upper } = this.confidence.band({ nav, summedBand, estimated });
    return {
      nav,
      confidenceLower: lower,
      confidenceUpper: upper,
      marketStatus: worstStatus,
      source,
      estimated, // IRON RULE: true ⇒ never a settlement price
      timestamp,
    };
  }

  /** Fallback ordering rank: later in the chain = weaker = higher rank. */
  private sourceRank(source: OracleSource): number {
    const order = [
      OracleSource.Chainlink,
      OracleSource.Pyth,
      OracleSource.RedStone,
      OracleSource.DexTwap,
      OracleSource.PerpMark,
      OracleSource.LastClose,
    ];
    return order.indexOf(source);
  }
}
