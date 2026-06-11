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
}

export type CommittedBasketCreatedEvent = BasketCreatedEvent;

export interface RebalanceBasketCreatedEvent extends ManagedBasketCreatedEvent {
  keeperBps: number;
  keeperEscrow: string;
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
    await this.upsertBasketWithConstituents(e, "Basket", null, null);
  }

  async applyManagedBasketCreated(e: ManagedBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Managed", e.manager, e.managerFeeBps);
  }

  async applyCommittedBasketCreated(e: CommittedBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Committed", null, null);
  }

  async applyRebalanceBasketCreated(e: RebalanceBasketCreatedEvent): Promise<void> {
    await this.upsertBasketWithConstituents(e, "Rebalance", e.manager, e.managerFeeBps, e.keeperBps, e.keeperEscrow);
  }

  private async upsertBasketWithConstituents(
    e: BasketCreatedEvent,
    vaultType: "Basket" | "Managed" | "Committed" | "Rebalance",
    manager: string | null,
    managerFeeBps: number | null,
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

    await this.prisma.$transaction([
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
    ]);
  }

  async getForwardTickets(vault: string, owner?: string) {
    return this.prisma.forwardTicket.findMany({
      where: { vaultAddress: vault, ...(owner ? { owner } : {}) },
      orderBy: { ticketId: "asc" },
    });
  }

  async getPendingForwardTickets(vault: string) {
    return this.prisma.forwardTicket.findMany({
      where: { vaultAddress: vault, status: { in: ["Pending", "Partial"] } },
      orderBy: { ticketId: "asc" },
    });
  }

  async getForwardHistory(vault: string) {
    return this.prisma.forwardEvent.findMany({
      where: { vaultAddress: vault },
      orderBy: { timestamp: "desc" },
    });
  }

  async getRebalanceVaultAddresses(): Promise<string[]> {
    const rows = await this.prisma.basket.findMany({
      where: { vaultType: "Rebalance" },
      select: { vaultAddress: true },
    });
    return rows.map((r) => r.vaultAddress);
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
}
