import { Injectable } from "@nestjs/common";
import { FairValueNAVAbi, ManagedRebalanceVaultAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import {
  OracleSource,
  OracleSeverity,
  type NavResult,
  severityFromCode,
  severityToVenueStatus,
} from "../domain/oracle.js";

export interface Recipe {
  tokens: `0x${string}`[];
  unitQty: bigint[];
  unitSize: bigint;
}

@Injectable()
export class OnChainNavReader {
  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
    private readonly signer: PayloadSignerService,
  ) {}

  /** L4 fair value for recipe-based vaults (Basket/Committed). Returns PER-UNIT value. */
  async readL4PerUnit(vault: `0x${string}`, recipe: Recipe): Promise<NavResult> {
    const fv = this.registry.address("FairValueNAV");
    if (!fv) throw new Error("FairValueNAV address not configured");

    const payloads = await Promise.all(recipe.tokens.map((t) => this.signer.payloadsFor(t)));

    const { result: res } = await this.chain.publicClient.simulateContract({
      address: fv,
      abi: FairValueNAVAbi,
      functionName: "navOf",
      args: [vault, recipe.tokens, recipe.unitQty, recipe.unitSize, payloads],
    });

    return this.mapNavResult(res as NavResultRaw);
  }

  /** L4 holdings NAV for rebalance vaults: values actual balances, returns PER-SHARE. */
  async readL4Holdings(vault: `0x${string}`): Promise<NavResult> {
    const fv = this.registry.address("FairValueNAV");
    if (!fv) throw new Error("FairValueNAV address not configured");

    const held = (await this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "heldTokens",
    })) as readonly `0x${string}`[];

    const payloads = await Promise.all(held.map((t) => this.signer.payloadsFor(t)));

    const { result: res } = await this.chain.publicClient.simulateContract({
      address: fv,
      abi: FairValueNAVAbi,
      functionName: "navOfHoldings",
      args: [vault, held, payloads],
    });

    const supply = (await this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "totalSupply",
    })) as bigint;

    const SCALE = 1_000_000_000_000_000_000n;
    const perShare = (x: bigint) => (supply === 0n ? 0n : (x * SCALE) / supply);
    const mapped = this.mapNavResult(res as NavResultRaw);
    return {
      ...mapped,
      nav: perShare(mapped.nav),
      confidenceLower: perShare(mapped.confidenceLower),
      confidenceUpper: perShare(mapped.confidenceUpper),
    };
  }

  private mapNavResult(res: NavResultRaw): NavResult {
    // L4 MarketStatus enum: Open=0, Degraded=1, Halted=2, Closed=3, Unknown=4.
    // Mapped to domain via OracleSeverity (same ordinal names/values):
    // Open→Regular, Halted→Closed, Closed→Closed, Degraded→Regular (degraded but alive), Unknown→Unknown.
    const severity = severityFromCode(Number(res.marketStatus));
    return {
      nav: res.nav,
      confidenceLower: res.confLower,
      confidenceUpper: res.confUpper,
      marketStatus: severityToVenueStatus(severity),
      source: OracleSource.Chainlink,
      estimated: severity !== OracleSeverity.Open || !res.safe,
      timestamp: Number(res.timestamp),
      severity,
      safe: res.safe,
    };
  }
}

interface NavResultRaw {
  nav: bigint;
  confLower: bigint;
  confUpper: bigint;
  marketStatus: number;
  safe: boolean;
  timestamp: bigint;
}
