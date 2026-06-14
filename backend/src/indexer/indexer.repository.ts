import { Injectable } from "@nestjs/common";
import { encodeAbiParameters, keccak256 } from "viem";
import type { Prisma } from "../generated/prisma/client.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { PrismaService } from "../persistence/prisma.service.js";

export interface BasketCreatedEvent {
  vaultAddress: string;
  creator: string;
  unitSize: bigint;
  name: string;
  symbol: string;
  constituents: { token: string; unitQty: bigint }[];
  recipeCommitment: string;
}

export interface ManagedBasketCreatedEvent extends BasketCreatedEvent {
  manager: string;
  managerFeeBps: number;
  /** Meridian's own AUM fee; null when the deployed impl predates the getter (read reverts). */
  platformFeeBps: number | null;
}

export type CommittedBasketCreatedEvent = BasketCreatedEvent;

export interface RebalanceBasketCreatedEvent extends ManagedBasketCreatedEvent {
  keeperBps: number;
  keeperEscrow: string;
}

/**
 * RegistryIndexCreated (5th type "registry"): manager comes from the event; everything else from
 * resilient vault reads. recipeCommitment is the on-chain genesis Merkle root (recipeRoot()), and
 * constituents are EMPTY here — the vault is not bootstrapped at creation (populated by the
 * RootScheduled / genesis paths in this slice).
 */
export type RegistryIndexCreatedEvent = RebalanceBasketCreatedEvent;

/**
 * A full registry-vault recipe (constituent set) to write, from either a `RootScheduled` log (the
 * curator-rotated target recipe) or the post-bootstrap genesis read (heldTokens/holdingsOf). The set
 * is authoritative: replacing it MUST prune tokens no longer present, so it carries the whole list.
 */
export interface RegistryConstituentsUpdate {
  vaultAddress: string;
  constituents: { token: string; unitQty: bigint }[];
}

export interface RebalancedEvent {
  vaultAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  recipient: string;
  acquire: string[];
  acquireIn: string[];
  release: string[];
  releaseOut: string[];
  timestampMs: number;
}

export interface TargetChangeEvent {
  vaultAddress: string;
  kind: "Scheduled" | "Activated";
  tokens: string[];
  unitQty: string[];
  effectiveAtMs: number | null;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestampMs: number;
}

export interface KeeperPayoutEvent {
  vaultAddress: string;
  to: string;
  amount: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestampMs: number;
}

export type ForwardEventKindLiteral =
  | "CreateRequested"
  | "RedeemRequested"
  | "Cancelled"
  | "Settled"
  | "PartialFill";

export interface ForwardTicketEvent {
  vaultAddress: string;
  queueAddress: string;
  ticketId: number;
  kind: ForwardEventKindLiteral;
  owner: string;
  /** ticket amount at request (cash 6-dec for create, shares 1e18 for redeem). */
  amount: bigint;
  /** remaining after this event (== amount on request, decremented on PartialFill, 0 on Settled). */
  remaining: bigint;
  /** cutoff unix-ms (request cutoff; refreshed on PartialFill). */
  cutoffMs: number;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestampMs: number;
  payload: Record<string, string>;
}

export type ActivityKindLiteral =
  | "Mint"
  | "Redeem"
  | "ForwardCreateRequested"
  | "ForwardRedeemRequested"
  | "ForwardPartialFill"
  | "ForwardSettled"
  | "ForwardCancelled";

/** In-kind mint/redeem row for the account activity feed (forward lifecycle is folded in by
 *  applyForwardEvent, which already knows the owner from the ticket). */
export interface ActivityEventRecord {
  owner: string;
  vaultAddress: string;
  kind: ActivityKindLiteral;
  payload: Record<string, string>;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  timestampMs: number;
}

/** Mirrors RecipeLib.commitment: keccak256(abi.encode(address[], uint256[], uint256)). */
export function recipeCommitment(
  tokens: readonly string[],
  unitQty: readonly bigint[],
  unitSize: bigint,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint256[]" }, { type: "uint256" }],
      [tokens as `0x${string}`[], [...unitQty], unitSize],
    ),
  );
}

/** Read-model writes for the indexer. All upserts so re-processing a log is a no-op. */
@Injectable()
export class IndexerRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenMeta: TokenMetadataService,
  ) {}

  async applyBasketCreated(e: BasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Basket", null, null, null);
  }

  async applyManagedBasketCreated(e: ManagedBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Managed", e.manager, e.managerFeeBps, e.platformFeeBps);
  }

  async applyCommittedBasketCreated(e: CommittedBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Committed", null, null, null);
  }

  async applyRebalanceBasketCreated(e: RebalanceBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(
      e, "Rebalance", e.manager, e.managerFeeBps, e.platformFeeBps, e.keeperBps, e.keeperEscrow,
    );
  }

  // Registry: same fee/keeper shape as Rebalance, but constituents are EMPTY (e.constituents == []).
  async applyRegistryIndexCreated(e: RegistryIndexCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(
      e, "Registry", e.manager, e.managerFeeBps, e.platformFeeBps, e.keeperBps, e.keeperEscrow,
    );
  }

  /**
   * Replace a registry vault's Constituent set with `u.constituents` (the authoritative recipe from a
   * RootScheduled log or the genesis read). The recipe can DROP tokens (a reconstitution), so this
   * prunes any constituent not in the new set rather than only upserting — otherwise a removed token
   * would linger. Delete-then-insert in one transaction keeps the row set exactly the recipe. A
   * mismatched address-casing on `u.vaultAddress` would orphan the rows from their Basket FK, so the
   * caller passes the Basket-stored (checksummed) address, not a raw lowercase `log.address`.
   */
  async replaceRegistryConstituents(u: RegistryConstituentsUpdate): Promise<void> {
    const tokens = u.constituents.map((c) => c.token);
    await this.prisma.$transaction([
      this.prisma.constituent.deleteMany({
        where: { vaultAddress: u.vaultAddress, token: { notIn: tokens } },
      }),
      ...u.constituents.map((c) =>
        this.prisma.constituent.upsert({
          where: { vaultAddress_token: { vaultAddress: u.vaultAddress, token: c.token } },
          create: { vaultAddress: u.vaultAddress, token: c.token, unitQty: c.unitQty.toString() },
          update: { unitQty: c.unitQty.toString() },
        }),
      ),
    ]);
    try { await this.tokenMeta.getMany(tokens); } catch { /* non-fatal cache warm */ }
  }

  private async upsertBasketWithConstituents(
    e: BasketCreatedEvent,
    vaultType: "Basket" | "Managed" | "Committed" | "Rebalance" | "Registry",
    manager: string | null,
    managerFeeBps: number | null,
    platformFeeBps: number | null = null,
    keeperBps: number | null = null,
    keeperEscrow: string | null = null,
  ): Promise<void> {
    const base = {
      unitSize: e.unitSize.toString(),
      name: e.name,
      symbol: e.symbol,
      vaultType,
      manager,
      managerFeeBps,
      platformFeeBps,
      keeperBps,
      keeperEscrow,
      recipeCommitment: e.recipeCommitment,
    };
    const tokens = e.constituents.map((c) => c.token);
    await this.prisma.$transaction([
      this.prisma.basket.upsert({
        where: { vaultAddress: e.vaultAddress },
        create: { vaultAddress: e.vaultAddress, ...base },
        update: base,
      }),
      ...e.constituents.map((c) =>
        this.prisma.constituent.upsert({
          where: { vaultAddress_token: { vaultAddress: e.vaultAddress, token: c.token } },
          create: { vaultAddress: e.vaultAddress, token: c.token, unitQty: c.unitQty.toString() },
          update: { unitQty: c.unitQty.toString() },
        }),
      ),
    ]);
    try { await this.tokenMeta.getMany(tokens); } catch { /* non-fatal cache warm */ }
  }

  async applyRebalanced(e: RebalancedEvent): Promise<void> {
    const data = {
      vaultAddress: e.vaultAddress,
      blockNumber: e.blockNumber,
      recipient: e.recipient,
      acquire: e.acquire,
      acquireIn: e.acquireIn,
      release: e.release,
      releaseOut: e.releaseOut,
      timestamp: new Date(e.timestampMs),
    };
    await this.prisma.rebalanceEvent.upsert({
      where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
      create: { txHash: e.txHash, logIndex: e.logIndex, ...data },
      update: data,
    });
  }

  async applyTargetChange(e: TargetChangeEvent): Promise<void> {
    const data = {
      vaultAddress: e.vaultAddress,
      kind: e.kind,
      tokens: e.tokens,
      unitQty: e.unitQty,
      effectiveAt: e.effectiveAtMs === null ? null : new Date(e.effectiveAtMs),
      blockNumber: e.blockNumber,
      timestamp: new Date(e.timestampMs),
    };
    await this.prisma.targetChange.upsert({
      where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
      create: { txHash: e.txHash, logIndex: e.logIndex, ...data },
      update: data,
    });
  }

  async applyKeeperPayout(e: KeeperPayoutEvent): Promise<void> {
    const data = {
      vaultAddress: e.vaultAddress,
      to: e.to,
      amount: e.amount.toString(),
      blockNumber: e.blockNumber,
      timestamp: new Date(e.timestampMs),
    };
    await this.prisma.keeperPayout.upsert({
      where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
      create: { txHash: e.txHash, logIndex: e.logIndex, ...data },
      update: data,
    });
  }

  async applyForwardEvent(e: ForwardTicketEvent): Promise<void> {
    const kindToStatus: Record<ForwardEventKindLiteral, "Pending" | "Partial" | "Settled" | "Cancelled" | null> = {
      CreateRequested: "Pending",
      RedeemRequested: "Pending",
      PartialFill: "Partial",
      Settled: "Settled",
      Cancelled: "Cancelled",
    };
    const status = kindToStatus[e.kind];
    const isRequest = e.kind === "CreateRequested" || e.kind === "RedeemRequested";
    const ticketKind = e.kind === "RedeemRequested" ? "Redeem" : "Create";
    // Settled fully consumes the ticket; Cancelled returns escrow — remaining shown as 0 either way.
    const remaining = e.kind === "Settled" || e.kind === "Cancelled" ? "0" : e.remaining.toString();
    const cutoff = new Date(e.cutoffMs);

    const ticketCreate: Prisma.ForwardTicketUncheckedCreateInput = {
      queueAddress: e.queueAddress,
      vaultAddress: e.vaultAddress,
      ticketId: e.ticketId,
      owner: e.owner,
      kind: ticketKind,
      amount: e.amount.toString(),
      remaining,
      status: status ?? "Pending",
      cutoff,
    };
    // On a non-request event the request row already set owner/kind/amount; only mutate the
    // settle-state fields so a re-index is a no-op and an out-of-order request can't clobber it.
    const ticketUpdate: Prisma.ForwardTicketUncheckedUpdateInput = isRequest
      ? ticketCreate
      : { status: status ?? "Pending", remaining, cutoff };

    const eventCreate: Prisma.ForwardEventUncheckedCreateInput = {
      txHash: e.txHash,
      logIndex: e.logIndex,
      queueAddress: e.queueAddress,
      vaultAddress: e.vaultAddress,
      ticketId: e.ticketId,
      kind: e.kind,
      payload: e.payload,
      timestamp: new Date(e.timestampMs),
    };

    // Fold into the per-account activity feed. Settle/Cancel/PartialFill carry no owner on the event,
    // so resolve it from the (already-indexed) request row; skip the activity row if still unknown.
    const activityKind = {
      CreateRequested: "ForwardCreateRequested",
      RedeemRequested: "ForwardRedeemRequested",
      PartialFill: "ForwardPartialFill",
      Settled: "ForwardSettled",
      Cancelled: "ForwardCancelled",
    }[e.kind] as ActivityKindLiteral;
    let owner = e.owner;
    if (!isRequest) {
      const existing = await this.prisma.forwardTicket.findUnique({
        where: { queueAddress_ticketId: { queueAddress: e.queueAddress, ticketId: e.ticketId } },
        select: { owner: true },
      });
      owner = existing?.owner ?? "";
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.forwardTicket.upsert({
        where: { queueAddress_ticketId: { queueAddress: e.queueAddress, ticketId: e.ticketId } },
        create: ticketCreate,
        update: ticketUpdate,
      }),
      this.prisma.forwardEvent.upsert({
        where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
        create: eventCreate,
        update: eventCreate,
      }),
    ];
    if (owner) {
      const activityData = {
        owner,
        vaultAddress: e.vaultAddress,
        kind: activityKind,
        payload: e.payload,
        blockNumber: e.blockNumber,
        timestamp: new Date(e.timestampMs),
      };
      ops.push(
        this.prisma.activityEvent.upsert({
          where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
          create: { txHash: e.txHash, logIndex: e.logIndex, ...activityData },
          update: activityData,
        }),
      );
    }
    await this.prisma.$transaction(ops);
  }

  async getForwardTickets(vault: string, owner?: string) {
    // Case-insensitive vault (URL param / lowercased keys may differ from the stored checksummed address);
    // owner is checksummed in both the event and the connected-wallet query, so match it exactly.
    return this.prisma.forwardTicket.findMany({
      where: { vaultAddress: { equals: vault, mode: "insensitive" }, ...(owner ? { owner } : {}) },
      orderBy: { ticketId: "asc" },
    });
  }

  async getPendingForwardTickets(vault: string) {
    // Case-insensitive on vaultAddress: the forward-settle keeper queries with the registry's lowercased
    // vault key, but tickets are stored under the checksummed Basket address — an exact match misses them.
    return this.prisma.forwardTicket.findMany({
      where: { vaultAddress: { equals: vault, mode: "insensitive" }, status: { in: ["Pending", "Partial"] } },
      orderBy: { ticketId: "asc" },
    });
  }

  async getForwardHistory(vault: string) {
    return this.prisma.forwardEvent.findMany({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
    });
  }

  /** OPEN (pending/partial) forward tickets for one owner across ALL vaults — the Portfolio queue
   *  section. Case-insensitive on owner (wallet addresses are checksum-cased, events may differ). */
  async getOpenForwardTicketsForOwner(owner: string) {
    return this.prisma.forwardTicket.findMany({
      where: { owner: { equals: owner, mode: "insensitive" }, status: { in: ["Pending", "Partial"] } },
      orderBy: { cutoff: "asc" },
    });
  }

  /** Idempotent write of an in-kind mint/redeem activity row (forward lifecycle is written by
   *  applyForwardEvent). No-op re-process via the (txHash, logIndex) unique key. */
  async applyActivityEvent(e: ActivityEventRecord): Promise<void> {
    const data = {
      owner: e.owner,
      vaultAddress: e.vaultAddress,
      kind: e.kind,
      payload: e.payload,
      blockNumber: e.blockNumber,
      timestamp: new Date(e.timestampMs),
    };
    await this.prisma.activityEvent.upsert({
      where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
      create: { txHash: e.txHash, logIndex: e.logIndex, ...data },
      update: data,
    });
  }

  /** Account-scoped activity feed (mint/redeem + forward lifecycle), newest first, with vault symbol. */
  async getActivityForOwner(owner: string, limit: number) {
    return this.prisma.activityEvent.findMany({
      where: { owner: { equals: owner, mode: "insensitive" } },
      orderBy: { timestamp: "desc" },
      take: limit,
      include: { basket: { select: { symbol: true } } },
    });
  }

  async getRebalanceVaultAddresses(): Promise<string[]> {
    const rows = await this.prisma.basket.findMany({
      where: { vaultType: "Rebalance" },
      select: { vaultAddress: true },
    });
    return rows.map((r) => r.vaultAddress);
  }

  /** Every indexed vault — all types emit Created/Redeemed, so the activity reader scans them all. */
  async getAllVaultAddresses(): Promise<string[]> {
    const rows = await this.prisma.basket.findMany({ select: { vaultAddress: true } });
    return rows.map((r) => r.vaultAddress);
  }

  /** All registry vaults (5th type) — the set scanned for RootScheduled/RootActivated recipe logs. */
  async getRegistryVaultAddresses(): Promise<string[]> {
    const rows = await this.prisma.basket.findMany({
      where: { vaultType: "Registry" },
      select: { vaultAddress: true },
    });
    return rows.map((r) => r.vaultAddress);
  }

  /**
   * Registry vaults whose Constituent set is still EMPTY — the genesis-population candidates. A registry
   * vault is created with no constituents (not bootstrapped at creation) and its composition lives behind
   * a Merkle root, so its constituents are filled once it is bootstrapped (heldTokens non-empty). Bounded:
   * a vault drops out of this set the moment its constituents are written, so the per-tick read is
   * O(unbootstrapped registry vaults) and trends to zero.
   */
  async getRegistryVaultsNeedingGenesis(): Promise<string[]> {
    const rows = await this.prisma.basket.findMany({
      where: { vaultType: "Registry", constituents: { none: {} } },
      select: { vaultAddress: true },
    });
    return rows.map((r) => r.vaultAddress);
  }

  /**
   * Genesis basket from the recipe persisted at deploy (keyed by the vault's recipeCommitment / Merkle
   * root). Lets the indexer populate a registry vault's constituents BEFORE it's bootstrapped — the
   * unitQty isn't on-chain, so this persisted recipe is the only pre-bootstrap source. [] if unknown.
   */
  async getGenesisConstituents(vault: string): Promise<{ token: string; unitQty: bigint }[]> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      select: { recipeCommitment: true },
    });
    const root = basket?.recipeCommitment?.toLowerCase();
    if (!root) return [];
    const recipe = await this.prisma.genesisRecipe.findUnique({ where: { root } });
    if (!recipe) return [];
    return recipe.tokens.map((token, i) => ({ token, unitQty: BigInt(recipe.unitQty[i] ?? "0") }));
  }

  async getRebalanceHistory(vault: string) {
    return this.prisma.rebalanceEvent.findMany({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
    });
  }

  async getKeeperPayouts(vault: string) {
    return this.prisma.keeperPayout.findMany({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
    });
  }

  async getLatestPendingTarget(vault: string) {
    const latest = await this.prisma.targetChange.findFirst({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
    });
    return latest && latest.kind === "Scheduled" ? latest : null;
  }

  async getLastRebalanceAt(vault: string): Promise<number | null> {
    const latest = await this.prisma.rebalanceEvent.findFirst({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    return latest ? latest.timestamp.getTime() : null;
  }

  async getCheckpoint(chainId: number): Promise<bigint | null> {
    const row = await this.prisma.indexerCheckpoint.findUnique({ where: { chainId } });
    return row?.lastProcessedBlock ?? null;
  }

  async setCheckpoint(chainId: number, block: bigint): Promise<void> {
    await this.prisma.indexerCheckpoint.upsert({
      where: { chainId },
      create: { chainId, lastProcessedBlock: block },
      update: { lastProcessedBlock: block },
    });
  }

  async upsertForwardQueueConfig(e: { vaultAddress: string; requestedBy: string; params: unknown }): Promise<void> {
    await this.prisma.forwardQueueConfig.upsert({
      where: { vaultAddress: e.vaultAddress },
      create: { vaultAddress: e.vaultAddress, requestedBy: e.requestedBy, params: e.params as object, status: "Pending" },
      update: { requestedBy: e.requestedBy, params: e.params as object, status: "Pending", error: null, step: null },
    });
  }

  async getForwardQueueConfig(vault: string) {
    return this.prisma.forwardQueueConfig.findUnique({ where: { vaultAddress: vault } });
  }

  async setForwardQueueStatus(vault: string, status: "Pending" | "Wiring" | "Live" | "Failed", data: { queueAddress?: string; step?: string; error?: string | null; txHashes?: string[] } = {}): Promise<void> {
    await this.prisma.forwardQueueConfig.update({ where: { vaultAddress: vault }, data: { status, ...data } });
  }

  async getLiveForwardQueues(): Promise<{ vault: string; queue: string }[]> {
    const rows = await this.prisma.forwardQueueConfig.findMany({ where: { status: "Live" } });
    return rows.filter((r) => r.queueAddress).map((r) => ({ vault: r.vaultAddress, queue: r.queueAddress! }));
  }

  async markNonceUsed(vault: string, nonce: string): Promise<void> {
    await this.prisma.forwardEnableNonce.create({ data: { vaultAddress: vault, nonce } });
  }

  async isNonceUsed(vault: string, nonce: string): Promise<boolean> {
    return (await this.prisma.forwardEnableNonce.findUnique({ where: { vaultAddress_nonce: { vaultAddress: vault, nonce } } })) !== null;
  }
}
