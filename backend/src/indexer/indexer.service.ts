import { Inject, Injectable, Logger } from "@nestjs/common";
import { decodeEventLog, type Log } from "viem";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { CloneFactoryReader } from "../contracts/clone-factory.reader.js";
import { BasketVaultReader } from "../contracts/basket-vault.reader.js";
import {
  type BasketCreatedEvent,
  type CommittedBasketCreatedEvent,
  type ManagedBasketCreatedEvent,
  type RebalanceBasketCreatedEvent,
  type RebalancedEvent,
  type TargetChangeEvent,
  type KeeperPayoutEvent,
  type ForwardTicketEvent,
  IndexerRepository,
  recipeCommitment,
} from "./indexer.repository.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { KeeperModuleReader } from "../contracts/keeper-module.reader.js";
import { ForwardCashQueueReader } from "../contracts/forward-cash-queue.reader.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";

export abstract class ChainLogReader {
  /** True when the factory address is configured for the active chain. */
  abstract isReady(): boolean;
  abstract getHeadBlock(): Promise<bigint>;
  abstract getBasketCreated(fromBlock: bigint, toBlock: bigint): Promise<BasketCreatedEvent[]>;
  abstract getManagedBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ManagedBasketCreatedEvent[]>;
  abstract getCommittedBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<CommittedBasketCreatedEvent[]>;
  abstract getRebalanceBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RebalanceBasketCreatedEvent[]>;
  abstract getVaultLifecycleLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<{ rebalanced: RebalancedEvent[]; targetChanges: TargetChangeEvent[] }>;
  abstract getKeeperPayoutLogs(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<KeeperPayoutEvent[]>;
  abstract getForwardQueueLogs(
    queue: string,
    vault: string,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ForwardTicketEvent[]>;
}

@Injectable()
export class ViemChainLogReader extends ChainLogReader {
  constructor(
    private readonly chain: ChainService,
    private readonly factory: CloneFactoryReader,
    private readonly vault: BasketVaultReader,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly keeper: KeeperModuleReader,
    private readonly forward: ForwardCashQueueReader,
    private readonly forwardQueues: ForwardQueueRegistry,
  ) {
    super();
  }

  isReady(): boolean {
    return this.factory.address !== undefined;
  }

  async getHeadBlock(): Promise<bigint> {
    return this.chain.publicClient.getBlockNumber();
  }

  async getBasketCreated(fromBlock: bigint, toBlock: bigint): Promise<BasketCreatedEvent[]> {
    const address = this.factory.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.factory.basketCreatedEvent,
      fromBlock,
      toBlock,
    });
    return logs.map((log) => {
      const a = this.decode(log);
      const tokens = a["tokens"] as readonly string[];
      const unitQty = a["unitQty"] as readonly bigint[];
      const unitSize = a["unitSize"] as bigint;
      return {
        vaultAddress: a["vault"] as string,
        creator: a["creator"] as string,
        unitSize,
        name: a["name"] as string,
        symbol: a["symbol"] as string,
        constituents: tokens.map((token, i) => ({ token, unitQty: unitQty[i]! })),
        recipeCommitment: recipeCommitment(tokens, unitQty, unitSize),
      };
    });
  }

  async getCommittedBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<CommittedBasketCreatedEvent[]> {
    const address = this.factory.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.factory.committedBasketCreatedEvent,
      fromBlock,
      toBlock,
    });
    return logs.map((log) => {
      const a = this.decode(log);
      const tokens = a["tokens"] as readonly string[];
      const unitQty = a["unitQty"] as readonly bigint[];
      const unitSize = a["unitSize"] as bigint;
      return {
        vaultAddress: a["vault"] as string,
        creator: a["creator"] as string,
        unitSize,
        name: a["name"] as string,
        symbol: a["symbol"] as string,
        constituents: tokens.map((token, i) => ({ token, unitQty: unitQty[i]! })),
        recipeCommitment: recipeCommitment(tokens, unitQty, unitSize),
      };
    });
  }

  // ManagedBasketCreated carries NO recipe — read it from the vault (ManagedVault is a storage vault).
  async getManagedBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ManagedBasketCreatedEvent[]> {
    const address = this.factory.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.factory.managedBasketCreatedEvent,
      fromBlock,
      toBlock,
    });
    const out: ManagedBasketCreatedEvent[] = [];
    for (const log of logs) {
      const a = this.decode(log);
      const vaultAddress = a["vault"] as `0x${string}`;
      const constituents = await this.vault.getConstituents(vaultAddress);
      const [unitSize, name, symbol] = await Promise.all([
        this.vault.unitSize(vaultAddress),
        this.vault.name(vaultAddress),
        this.vault.symbol(vaultAddress),
      ]);
      const tokens = constituents.map((c) => c.token);
      const unitQty = constituents.map((c) => c.unitQty);
      out.push({
        vaultAddress,
        creator: a["creator"] as string,
        manager: a["manager"] as string,
        managerFeeBps: Number(a["managerFeeBps"] as bigint | number),
        unitSize,
        name,
        symbol,
        constituents: constituents.map((c) => ({ token: c.token, unitQty: c.unitQty })),
        recipeCommitment: recipeCommitment(tokens, unitQty, unitSize),
      });
    }
    return out;
  }

  // RebalanceBasketCreated carries NO recipe/fee/keeper — read them from the vault.
  async getRebalanceBasketCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RebalanceBasketCreatedEvent[]> {
    const address = this.factory.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.factory.rebalanceBasketCreatedEvent,
      fromBlock,
      toBlock,
    });
    const out: RebalanceBasketCreatedEvent[] = [];
    for (const log of logs) {
      const a = this.decode(log);
      const vaultAddress = a["vault"] as `0x${string}`;
      const constituents = await this.vault.getConstituents(vaultAddress);
      const [unitSize, name, symbol, managerFeeBps, keeperBps, keeperEscrow] = await Promise.all([
        this.vault.unitSize(vaultAddress),
        this.vault.name(vaultAddress),
        this.vault.symbol(vaultAddress),
        this.rebVault.managerFeeBps(vaultAddress),
        this.rebVault.keeperBps(vaultAddress),
        this.rebVault.keeperEscrow(vaultAddress),
      ]);
      const tokens = constituents.map((c) => c.token);
      const unitQty = constituents.map((c) => c.unitQty);
      out.push({
        vaultAddress,
        creator: a["creator"] as string,
        manager: a["manager"] as string,
        managerFeeBps,
        keeperBps,
        keeperEscrow,
        unitSize,
        name,
        symbol,
        constituents: constituents.map((c) => ({ token: c.token, unitQty: c.unitQty })),
        recipeCommitment: recipeCommitment(tokens, unitQty, unitSize),
      });
    }
    return out;
  }

  private readonly blockTsCache = new Map<bigint, number>();

  private async tsOf(blockNumber: bigint): Promise<number> {
    const hit = this.blockTsCache.get(blockNumber);
    if (hit !== undefined) return hit;
    const block = await this.chain.publicClient.getBlock({ blockNumber });
    const ms = Number(block.timestamp) * 1000;
    this.blockTsCache.set(blockNumber, ms);
    return ms;
  }

  async getVaultLifecycleLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<{ rebalanced: RebalancedEvent[]; targetChanges: TargetChangeEvent[] }> {
    const set = new Set(addresses.map((a) => a.toLowerCase()));
    // Key child rows by the Basket-stored (checksummed) address, NOT the raw lowercase `log.address`,
    // or the Rebalanced/TargetChange FK to Basket.vaultAddress violates on a case mismatch.
    const byCase = new Map(addresses.map((a) => [a.toLowerCase(), a]));
    const rebalanced: RebalancedEvent[] = [];
    const targetChanges: TargetChangeEvent[] = [];

    const rebLogs = await this.chain.publicClient.getLogs({
      event: this.rebVault.rebalancedEvent,
      fromBlock,
      toBlock,
    });
    for (const log of rebLogs) {
      if (!set.has(log.address.toLowerCase())) continue;
      const a = this.decodeWith(this.rebVault.abi, log);
      rebalanced.push({
        vaultAddress: byCase.get(log.address.toLowerCase()) ?? log.address,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber!,
        recipient: a["recipient"] as string,
        acquire: (a["acquire"] as readonly string[]).map(String),
        acquireIn: (a["acquireIn"] as readonly bigint[]).map((x) => x.toString()),
        release: (a["release"] as readonly string[]).map(String),
        releaseOut: (a["releaseOut"] as readonly bigint[]).map((x) => x.toString()),
        timestampMs: await this.tsOf(log.blockNumber!),
      });
    }

    for (const [event, kind] of [
      [this.rebVault.targetScheduledEvent, "Scheduled"],
      [this.rebVault.targetActivatedEvent, "Activated"],
    ] as const) {
      const logs = await this.chain.publicClient.getLogs({ event, fromBlock, toBlock });
      for (const log of logs) {
        if (!set.has(log.address.toLowerCase())) continue;
        const a = this.decodeWith(this.rebVault.abi, log);
        const eff = a["effectiveAt"] as bigint | undefined;
        targetChanges.push({
          vaultAddress: byCase.get(log.address.toLowerCase()) ?? log.address,
          kind,
          tokens: (a["tokens"] as readonly string[]).map(String),
          unitQty: (a["unitQty"] as readonly bigint[]).map((x) => x.toString()),
          effectiveAtMs: eff === undefined ? null : Number(eff) * 1000,
          txHash: log.transactionHash!,
          logIndex: log.logIndex!,
          blockNumber: log.blockNumber!,
          timestampMs: await this.tsOf(log.blockNumber!),
        });
      }
    }
    return { rebalanced, targetChanges };
  }

  async getKeeperPayoutLogs(fromBlock: bigint, toBlock: bigint): Promise<KeeperPayoutEvent[]> {
    const address = this.keeper.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.keeper.rewardPaidEvent,
      fromBlock,
      toBlock,
    });
    const out: KeeperPayoutEvent[] = [];
    for (const log of logs) {
      const a = this.decodeWith(this.keeper.abi, log);
      out.push({
        vaultAddress: a["vaultShare"] as string,
        to: a["to"] as string,
        amount: a["amount"] as bigint,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber!,
        timestampMs: await this.tsOf(log.blockNumber!),
      });
    }
    return out;
  }

  async getForwardQueueLogs(
    queue: string,
    vault: string,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ForwardTicketEvent[]> {
    const address = queue as `0x${string}`;
    const out: ForwardTicketEvent[] = [];

    const base = async (kind: ForwardTicketEvent["kind"], event: { name: string }) => {
      const logs = (await this.chain.publicClient.getLogs({
        address,
        event,
        fromBlock,
        toBlock,
      } as never)) as Log[];
      for (const log of logs) {
        // getLogs({ event }) returns logs with decoded `args` already populated — no re-decode needed.
        const a = ((log as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>;
        const ticketId = Number(a["id"] as bigint);
        const ts = await this.tsOf(log.blockNumber!);
        if (kind === "CreateRequested" || kind === "RedeemRequested") {
          const amt = (kind === "CreateRequested" ? a["cash"] : a["shares"]) as bigint;
          out.push({
            vaultAddress: vault, queueAddress: queue, ticketId, kind,
            owner: a["owner"] as string, amount: amt, remaining: amt,
            cutoffMs: Number(a["cutoff"] as bigint) * 1000,
            txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
            timestampMs: ts, payload: { amount: amt.toString(), cutoff: (a["cutoff"] as bigint).toString() },
          });
        } else if (kind === "PartialFill") {
          const remaining = a["remainingCash"] as bigint;
          out.push({
            vaultAddress: vault, queueAddress: queue, ticketId, kind,
            owner: "", amount: 0n, remaining,
            cutoffMs: await this.forwardCutoffMs(address, ticketId),
            txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
            timestampMs: ts,
            payload: { filledCash: (a["filledCash"] as bigint).toString(), remainingCash: remaining.toString() },
          });
        } else {
          // Settled / Cancelled — id-only; owner/amount come from the indexed request row.
          out.push({
            vaultAddress: vault, queueAddress: queue, ticketId, kind,
            owner: "", amount: 0n, remaining: 0n, cutoffMs: ts,
            txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
            timestampMs: ts, payload: {},
          });
        }
      }
    };

    await base("CreateRequested", this.forward.createRequestedEvent);
    await base("RedeemRequested", this.forward.redeemRequestedEvent);
    await base("PartialFill", this.forward.partialFillEvent);
    await base("Settled", this.forward.settledEvent);
    await base("Cancelled", this.forward.cancelledEvent);
    return out;
  }

  /** Best-effort read of the (possibly refreshed) cutoff for a ticket; falls back to now+0 on failure. */
  private async forwardCutoffMs(queue: `0x${string}`, ticketId: number): Promise<number> {
    try {
      const t = (await this.chain.publicClient.readContract({
        address: queue, abi: this.forward.abi, functionName: "tickets", args: [BigInt(ticketId)],
      })) as readonly [string, boolean, bigint, bigint, number];
      return Number(t[3]) * 1000;
    } catch {
      return 0;
    }
  }

  private decode(log: Log): Record<string, unknown> {
    const decoded = decodeEventLog({
      abi: this.factory.abi,
      data: (log as Log).data,
      topics: (log as Log).topics,
    });
    return decoded.args as Record<string, unknown>;
  }

  private decodeWith(abi: readonly unknown[], log: Log): Record<string, unknown> {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics } as never);
    return decoded.args as Record<string, unknown>;
  }
}

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private readonly chainId: number;
  private readonly startBlock: bigint;
  private static readonly MAX_RANGE = 2_000n;

  constructor(
    private readonly config: ConfigService,
    private readonly repo: IndexerRepository,
    @Inject(ChainLogReader) private readonly reader: ChainLogReader,
    private readonly forwardQueues: ForwardQueueRegistry,
  ) {
    this.chainId = this.config.get("CHAIN_ID");
    this.startBlock = BigInt(this.config.get("INDEXER_START_BLOCK") ?? 0);
  }

  async tick(): Promise<number> {
    // Don't advance the checkpoint while the factory is unconfigured — otherwise the checkpoint
    // marches past real deploys and they're never backfilled.
    if (!this.reader.isReady()) {
      this.logger.warn("indexer: factory address not configured for this chain; skipping tick");
      return 0;
    }
    const head = await this.reader.getHeadBlock();
    // Fresh checkpoint backfills from INDEXER_START_BLOCK (deploy block); 0 keeps the head-1 default.
    const floor = this.startBlock > 0n ? this.startBlock - 1n : head - 1n;
    const last = (await this.repo.getCheckpoint(this.chainId)) ?? floor;
    if (head <= last) return 0;

    const from = last + 1n;
    const to = head - from > IndexerService.MAX_RANGE ? from + IndexerService.MAX_RANGE : head;

    const [basic, managed, committed, rebalance] = await Promise.all([
      this.reader.getBasketCreated(from, to),
      this.reader.getManagedBasketCreated(from, to),
      this.reader.getCommittedBasketCreated(from, to),
      this.reader.getRebalanceBasketCreated(from, to),
    ]);
    for (const e of basic) await this.repo.applyBasketCreated(e);
    for (const e of managed) await this.repo.applyManagedBasketCreated(e);
    for (const e of committed) await this.repo.applyCommittedBasketCreated(e);
    for (const e of rebalance) await this.repo.applyRebalanceBasketCreated(e);

    const rebAddresses = (await this.repo.getRebalanceVaultAddresses()) as `0x${string}`[];
    let lifecycleCount = 0;
    if (rebAddresses.length > 0) {
      const { rebalanced, targetChanges } = await this.reader.getVaultLifecycleLogs(
        rebAddresses,
        from,
        to,
      );
      for (const e of rebalanced) await this.repo.applyRebalanced(e);
      for (const e of targetChanges) await this.repo.applyTargetChange(e);
      const payouts = await this.reader.getKeeperPayoutLogs(from, to);
      for (const e of payouts) await this.repo.applyKeeperPayout(e);
      lifecycleCount = rebalanced.length + targetChanges.length + payouts.length;
    }

    let forwardCount = 0;
    for (const { vault, queue } of this.forwardQueues.pairs()) {
      const evs = await this.reader.getForwardQueueLogs(queue, vault, from, to);
      for (const e of evs) await this.repo.applyForwardEvent(e);
      forwardCount += evs.length;
    }

    await this.repo.setCheckpoint(this.chainId, to);
    const n =
      basic.length + managed.length + committed.length + rebalance.length + lifecycleCount + forwardCount;
    this.logger.debug(`indexer tick (${from}, ${to}] -> ${n} events`);
    return n;
  }
}
