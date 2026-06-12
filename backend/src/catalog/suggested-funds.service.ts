import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Injectable, Logger } from "@nestjs/common";
import type { SuggestedFund, SuggestedFundsResponse, VaultType } from "@meridian/sdk";
import { ConfigService } from "../config/config.service.js";

/** Top-N constituents surfaced per fund (display cap; full count kept in holdingsCount). */
const SAMPLE_CAP = 6;
/** Minimum resolvable constituents for a fund to be usable as a wizard starting point. */
const MIN_RESOLVABLE = 2;

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-relative candidates so the read works from both src (dev/test) and dist/ (prod). */
function candidatePaths(): string[] {
  return [
    // src: backend/src/catalog -> repo root is 4 up
    resolve(here, "../../../tools/registry/out/suggested_funds.json"),
    // dist: backend/dist/catalog -> repo root is 4 up (same), kept explicit for clarity
    resolve(here, "../../../../tools/registry/out/suggested_funds.json"),
    resolve(process.cwd(), "tools/registry/out/suggested_funds.json"),
    resolve(process.cwd(), "../tools/registry/out/suggested_funds.json"),
  ];
}

/** Maps the catalog's recommended contract type onto the FE/SDK VaultType enum. */
function mapVaultKind(type: string): VaultType {
  switch (type) {
    case "BasketVault":
      return "basket";
    case "CommittedVault":
      return "committed";
    case "ManagedRebalanceVault":
      return "rebalance";
    case "RegistryRebalanceVault":
      return "registry";
    case "ManagedVault":
      return "managed";
    default:
      return "basket";
  }
}

interface RawConstituent {
  ticker?: string;
  weight_pct?: number;
  address?: string | null;
}
interface RawFund {
  id?: string;
  name?: string;
  description?: string;
  theme?: string;
  coverage_pct?: number;
  constituent_count?: number;
  vault?: { type?: string };
  constituents?: RawConstituent[];
}
interface RawCatalog {
  funds?: RawFund[];
}

@Injectable()
export class SuggestedFundsService {
  private readonly logger = new Logger(SuggestedFundsService.name);
  private cache: SuggestedFundsResponse | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Lazily read + shape the catalog once; subsequent calls hit the cache. */
  get(): SuggestedFundsResponse {
    if (this.cache) return this.cache;
    const raw = this.readCatalog();
    const allow = this.tokenAllowlist();
    const funds = (raw.funds ?? []).map((f) => this.shapeFund(f, allow));
    this.cache = { funds };
    return this.cache;
  }

  private shapeFund(f: RawFund, allow: Set<string>): SuggestedFund {
    const constituents = f.constituents ?? [];
    const toBps = (pct: number | undefined): number => Math.max(0, Math.round((pct ?? 0) * 100));

    const sampleHoldings = constituents.slice(0, SAMPLE_CAP).map((c) => ({
      symbol: c.ticker ?? "",
      weightBps: toBps(c.weight_pct),
      address: c.address ?? null,
    }));

    const resolvableTokens = constituents
      .filter((c) => typeof c.address === "string" && allow.has(c.address.toLowerCase()))
      .map((c) => ({
        token: (c.address as string).toLowerCase(),
        symbol: c.ticker ?? "",
        weightBps: toBps(c.weight_pct),
      }));

    return {
      id: f.id ?? "",
      name: f.name ?? f.id ?? "",
      category: f.theme ?? "",
      recommendedVaultKind: mapVaultKind(f.vault?.type ?? ""),
      description: f.description ?? "",
      sampleHoldings,
      holdingsCount: f.constituent_count ?? constituents.length,
      coveragePct: f.coverage_pct,
      resolvableTokens: resolvableTokens.length >= MIN_RESOLVABLE ? resolvableTokens : [],
    };
  }

  private readCatalog(): RawCatalog {
    const configured = this.config.get("SUGGESTED_FUNDS_PATH");
    const paths = configured ? [resolve(configured), ...candidatePaths()] : candidatePaths();
    for (const p of paths) {
      try {
        const parsed = JSON.parse(readFileSync(p, "utf8")) as RawCatalog;
        if (parsed && Array.isArray(parsed.funds)) return parsed;
      } catch {
        // try the next candidate
      }
    }
    this.logger.warn(`suggested_funds.json not found in any candidate path; serving an empty catalog`);
    return { funds: [] };
  }

  private tokenAllowlist(): Set<string> {
    try {
      const parsed = JSON.parse(this.config.get("SUGGESTED_FUNDS_TOKENS"));
      if (Array.isArray(parsed)) return new Set(parsed.map((a) => String(a).toLowerCase()));
    } catch {
      this.logger.warn("SUGGESTED_FUNDS_TOKENS is not a JSON array; treating all funds as reference-only");
    }
    return new Set();
  }
}
