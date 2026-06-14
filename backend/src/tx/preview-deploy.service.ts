import { Injectable } from "@nestjs/common";
import { parseUnits, zeroAddress } from "viem";
import { CloneFactoryAbi } from "@meridian/contracts";
import type { PreviewDeployRequest, DeployPreview, FeeQuote } from "@meridian/sdk";
import { ChainService } from "../chain/chain.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { catalogPrice18 } from "../contracts/catalog-price.js";
import { buildGenesisRoot } from "./registry-recipe.js";

const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// CloneFactory.VaultType enum index per vaultKind (BASKET=0, COMMITTED=1, MANAGED=2, REBALANCE=3,
// REGISTRY=4). registry deploy is a later slice — the index only feeds creationFee(VaultType) reads.
const VAULT_TYPE_INDEX: Record<PreviewDeployRequest["vaultKind"], number> = {
  basket: 0,
  committed: 1,
  managed: 2,
  rebalance: 3,
  registry: 4,
};

/**
 * Reader that turns wizard inputs into the on-chain create args: derives unitQty
 * (quantities mode parses directly; weights mode = notional*weight/price), prices the
 * basket informationally, and simulate-creates the vault for its predicted address.
 */
@Injectable()
export class PreviewDeployService {
  constructor(
    private readonly chain: ChainService,
    private readonly prisma: PrismaService,
    private readonly meta: TokenMetadataService,
    private readonly registry: CapabilityRegistry,
  ) {}

  async preview(req: PreviewDeployRequest): Promise<DeployPreview> {
    // Defensive: a malformed/out-of-band caller could send a composition whose length
    // doesn't match tokens (the FE always aligns them). Gate instead of throwing.
    const compLen = req.composition.mode === "quantities" ? req.composition.qty.length : req.composition.weightsBps.length;
    if (compLen !== req.tokens.length) {
      return { unitQty: [], breakdown: [], totalValueUsd: "0", priceMissing: [], predictedVault: null, gate: { gated: true, reason: "length-mismatch" } };
    }

    const meta = await this.meta.getMany(req.tokens);
    const decimalsOf = (t: string) => meta[t.toLowerCase()]?.decimals ?? 18;
    const symbolOf = (t: string) => meta[t.toLowerCase()]?.symbol ?? t.slice(0, 6);

    // latest 18-dec USD price per token (casing not normalized in PriceSnapshot — try as-is then lowercase).
    // Demo-catalog stocks have no snapshot until they're in an indexed vault, so fall back to the catalog
    // baseline — otherwise every brand-new basket would price its constituents as "no price".
    const priceOf = async (t: string): Promise<bigint> => {
      const snap =
        (await this.prisma.priceSnapshot.findFirst({ where: { token: t }, orderBy: { timestamp: "desc" } })) ??
        (await this.prisma.priceSnapshot.findFirst({ where: { token: t.toLowerCase() }, orderBy: { timestamp: "desc" } }));
      if (snap) return BigInt(snap.price.toFixed(0));
      return catalogPrice18(t) ?? 0n;
    };

    const priceMissing: string[] = [];
    const unitQty: bigint[] = [];

    if (req.composition.mode === "quantities") {
      for (const q of req.composition.qty) unitQty.push(parseUnits(q, 18));
    } else {
      const notional = parseUnits(req.composition.valuePerUnitUsd, 18); // 18-dec USD
      for (let i = 0; i < req.tokens.length; i++) {
        const price = await priceOf(req.tokens[i]!);
        if (price === 0n) {
          priceMissing.push(req.tokens[i]!);
          unitQty.push(0n);
          continue;
        }
        const valueUsd = (notional * BigInt(req.composition.weightsBps[i] ?? 0)) / 10000n; // 18-dec USD for this leg
        const qtyBase = (valueUsd * 10n ** BigInt(decimalsOf(req.tokens[i]!))) / price; // token base units (floor = dust)
        unitQty.push(qtyBase);
      }
    }

    // breakdown + total (informational in quantities mode; never gates there)
    const breakdown: DeployPreview["breakdown"] = [];
    let total = 0n;
    for (let i = 0; i < req.tokens.length; i++) {
      const token = req.tokens[i]!;
      const dec = decimalsOf(token);
      const price = await priceOf(token);
      const valueUsd = (unitQty[i]! * price) / 10n ** BigInt(dec); // 18-dec USD
      total += valueUsd;
      breakdown.push({ token, symbol: symbolOf(token), qty: formatBase(unitQty[i]!, dec), valueUsd: valueUsd.toString(), weightBps: 0 });
    }
    for (const b of breakdown) b.weightBps = total > 0n ? Number((BigInt(b.valueUsd) * 10000n) / total) : 0;

    // weights-mode price gate
    if (req.composition.mode === "weights" && priceMissing.length > 0) {
      return { unitQty: unitQty.map(String), breakdown, totalValueUsd: total.toString(), priceMissing, predictedVault: null, gate: { gated: true, reason: "price-missing" } };
    }

    // predicted address via simulate-create (also pre-flights the rebalance whitelist)
    const predicted = await this.simulateCreate(req, unitQty);
    const creationFee = await this.readCreationFee(req.vaultKind);
    return {
      unitQty: unitQty.map(String),
      breakdown,
      totalValueUsd: total.toString(),
      priceMissing,
      predictedVault: predicted.address,
      gate: predicted.address ? { gated: false, reason: "none" } : { gated: true, reason: predicted.reason },
      ...(creationFee ? { creationFee } : {}),
    };
  }

  // The fixed USDG fund-creation fee the deployer pays the factory for this vault TYPE. The currently-
  // deployed factory predates these getters, so a live read reverts → undefined (no fee). USDG is
  // priced at $1: valueUsd = amount scaled from its decimals to canonical 18-dec USD.
  private async readCreationFee(vaultKind: PreviewDeployRequest["vaultKind"]): Promise<FeeQuote | undefined> {
    const factory = this.registry.address("CloneFactory");
    if (!factory) return undefined;
    try {
      const [token, amount] = await Promise.all([
        this.chain.publicClient.readContract({
          address: factory as `0x${string}`, abi: CloneFactoryAbi, functionName: "creationFeeToken",
        }) as Promise<`0x${string}`>,
        this.chain.publicClient.readContract({
          address: factory as `0x${string}`, abi: CloneFactoryAbi, functionName: "creationFee", args: [VAULT_TYPE_INDEX[vaultKind]],
        }) as Promise<bigint>,
      ]);
      if (amount <= 0n || token === zeroAddress) return undefined;
      const m = (await this.meta.getMany([token]))[token.toLowerCase()] ?? { symbol: token.slice(0, 6), decimals: 18 };
      const valueUsd = (amount * 10n ** 18n) / 10n ** BigInt(m.decimals);
      return { token, symbol: m.symbol, amount: amount.toString(), valueUsd: valueUsd.toString() };
    } catch {
      return undefined;
    }
  }

  private async simulateCreate(req: PreviewDeployRequest, unitQty: bigint[]): Promise<{ address: string | null; reason: string }> {
    const factory = this.registry.address("CloneFactory");
    if (!factory) return { address: null, reason: "not-deployed" };
    const tokens = req.tokens as `0x${string}`[];
    const unitSize = parseUnits(req.unitSize, 18);
    const salt = (req.userSalt ?? DEFAULT_SALT) as `0x${string}`;
    const manager = (req.manager || req.account) as `0x${string}`;
    const account = req.account as `0x${string}`;
    const base = { address: factory as `0x${string}`, abi: CloneFactoryAbi, account } as const;
    try {
      let sim: { result: unknown };
      if (req.vaultKind === "managed") {
        sim = await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "createManagedBasket",
          args: [{ tokens, unitQty, unitSize, name: req.name, symbol: req.symbol, manager, managerFeeBps: req.managerFeeBps ?? 0 }, salt],
        });
      } else if (req.vaultKind === "committed") {
        sim = await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "createCommittedBasket",
          args: [tokens, unitQty, unitSize, req.name, req.symbol, salt],
        });
      } else if (req.vaultKind === "rebalance") {
        sim = await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "createRebalanceBasket",
          args: [{ tokens, unitQty, unitSize, name: req.name, symbol: req.symbol, manager, managerFeeBps: req.managerFeeBps ?? 0, keeperBps: req.keeperBps ?? 0, keeperEscrow: (req.keeperEscrow ?? ZERO_ADDRESS) as `0x${string}` }, salt],
        });
      } else if (req.vaultKind === "registry") {
        // genesisRoot from sorted (tokens, unitQty, unitSize) Merkle leaves (must match the contract);
        // the struct carries genesisRoot + sorted tokens, NOT unitQty (quantities live in leaves/bootstrap).
        const { genesisRoot, sortedTokens } = buildGenesisRoot(tokens, unitQty, unitSize);
        sim = await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "createRegistryIndex",
          args: [{ genesisRoot, tokens: sortedTokens, unitSize, name: req.name, symbol: req.symbol, manager, managerFeeBps: req.managerFeeBps ?? 0, keeperBps: req.keeperBps ?? 0, keeperEscrow: (req.keeperEscrow ?? ZERO_ADDRESS) as `0x${string}` }, salt],
        });
      } else {
        sim = await this.chain.publicClient.simulateContract({
          ...base,
          functionName: "createBasket",
          args: [tokens, unitQty, unitSize, req.name, req.symbol, salt],
        });
      }
      return { address: String(sim.result), reason: "none" };
    } catch (e) {
      return { address: null, reason: e instanceof Error ? shortRevert(e.message) : "revert" };
    }
  }
}

function formatBase(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

function shortRevert(msg: string): string {
  const m = msg.match(/([A-Z][A-Za-z0-9]+)\(\)/);
  return m ? m[1]! : msg.split("\n")[0]!.slice(0, 80);
}
