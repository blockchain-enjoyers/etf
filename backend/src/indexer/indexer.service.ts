import { Inject, Injectable, Logger } from "@nestjs/common";
import { BasketVaultAbi, ManagedRebalanceVaultAbi, ManagedVaultAbi, RegistryRebalanceVaultAbi } from "@meridian/contracts";
import { decodeEventLog, getAddress, type Log } from "viem";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { CloneFactoryReader } from "../contracts/clone-factory.reader.js";
import { BasketVaultReader } from "../contracts/basket-vault.reader.js";
import {
  type BasketCreatedEvent,
  type CommittedBasketCreatedEvent,
  type ManagedBasketCreatedEvent,
  type RebalanceBasketCreatedEvent,
  type RegistryIndexCreatedEvent,
  type RegistryConstituentsUpdate,
  type RebalancedEvent,
  type TargetChangeEvent,
  type KeeperPayoutEvent,
  type ForwardTicketEvent,
  type ActivityEventRecord,
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
  abstract getRegistryIndexCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RegistryIndexCreatedEvent[]>;
  abstract getVaultLifecycleLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<{ rebalanced: RebalancedEvent[]; targetChanges: TargetChangeEvent[] }>;
  /** RootScheduled recipe logs for registry vaults — the full target recipe to write as constituents. */
  abstract getRegistryRecipeLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RegistryConstituentsUpdate[]>;
  /** Post-bootstrap genesis recipe (heldTokens + holdingsOf); empty if unbootstrapped or a read reverts. */
  abstract readRegistryGenesis(
    vault: `0x${string}`,
  ): Promise<{ token: string; unitQty: bigint }[]>;
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
  /** In-kind mint/redeem (vault Created/Redeemed) across all given vaults — the account activity feed. */
  abstract getVaultActivityLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ActivityEventRecord[]>;
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

  // Registry recipe events live ONLY on RegistryRebalanceVaultAbi (RootCommitment is registry-only;
  // ManagedRebalanceVaultAbi has TargetScheduled instead), so they are decoded with that ABI, not
  // this.rebVault.abi.
  private readonly rootScheduledEvent = RegistryRebalanceVaultAbi.find(
    (e): e is Extract<(typeof RegistryRebalanceVaultAbi)[number], { type: "event"; name: "RootScheduled" }> =>
      e.type === "event" && e.name === "RootScheduled",
  )!;

  // In-kind mint/redeem events share one signature across every vault type, so the basic vault ABI
  // decodes them for the whole address set.
  private readonly createdEvent = BasketVaultAbi.find(
    (e): e is Extract<(typeof BasketVaultAbi)[number], { type: "event"; name: "Created" }> =>
      e.type === "event" && e.name === "Created",
  )!;
  private readonly redeemedEvent = BasketVaultAbi.find(
    (e): e is Extract<(typeof BasketVaultAbi)[number], { type: "event"; name: "Redeemed" }> =>
      e.type === "event" && e.name === "Redeemed",
  )!;

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
      const [unitSize, name, symbol, platformFeeBps] = await Promise.all([
        this.vault.unitSize(vaultAddress),
        this.vault.name(vaultAddress),
        this.vault.symbol(vaultAddress),
        this.tryPlatformFeeBps(vaultAddress, ManagedVaultAbi),
      ]);
      const tokens = constituents.map((c) => c.token);
      const unitQty = constituents.map((c) => c.unitQty);
      out.push({
        vaultAddress,
        creator: a["creator"] as string,
        manager: a["manager"] as string,
        managerFeeBps: Number(a["managerFeeBps"] as bigint | number),
        platformFeeBps,
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
      const [unitSize, name, symbol, managerFeeBps, keeperBps, keeperEscrow, platformFeeBps] =
        await Promise.all([
          this.vault.unitSize(vaultAddress),
          this.vault.name(vaultAddress),
          this.vault.symbol(vaultAddress),
          this.rebVault.managerFeeBps(vaultAddress),
          this.rebVault.keeperBps(vaultAddress),
          this.rebVault.keeperEscrow(vaultAddress),
          this.tryPlatformFeeBps(vaultAddress, ManagedRebalanceVaultAbi),
        ]);
      const tokens = constituents.map((c) => c.token);
      const unitQty = constituents.map((c) => c.unitQty);
      out.push({
        vaultAddress,
        creator: a["creator"] as string,
        manager: a["manager"] as string,
        managerFeeBps,
        platformFeeBps,
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

  // RegistryIndexCreated (5th type): manager from the EVENT; the rest from RegistryRebalanceVault
  // reads. Constituents stay EMPTY (the vault is not bootstrapped at creation — a later slice fills
  // them). recipeCommitment = the genesis Merkle root recipeRoot(). EVERY read is wrapped (try/catch
  // → null/default) so one reverting getter can never freeze the indexer checkpoint (known prior bug).
  async getRegistryIndexCreated(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RegistryIndexCreatedEvent[]> {
    const address = this.factory.address;
    if (!address) return [];
    const logs = await this.chain.publicClient.getLogs({
      address,
      event: this.factory.registryIndexCreatedEvent,
      fromBlock,
      toBlock,
    });
    const out: RegistryIndexCreatedEvent[] = [];
    for (const log of logs) {
      const a = this.decode(log);
      const vaultAddress = a["vault"] as `0x${string}`;
      const [unitSize, name, symbol, managerFeeBps, keeperBps, keeperEscrow, platformFeeBps, recipeRoot] =
        await Promise.all([
          this.tryRegistryRead<bigint>(vaultAddress, "unitSize"),
          this.tryRegistryRead<string>(vaultAddress, "name"),
          this.tryRegistryRead<string>(vaultAddress, "symbol"),
          this.tryRegistryRead<number>(vaultAddress, "managerFeeBps"),
          this.tryRegistryRead<number>(vaultAddress, "keeperBps"),
          this.tryRegistryRead<`0x${string}`>(vaultAddress, "keeperEscrow"),
          this.tryRegistryRead<number>(vaultAddress, "platformFeeBps"),
          this.tryRegistryRead<`0x${string}`>(vaultAddress, "recipeRoot"),
        ]);
      out.push({
        vaultAddress,
        creator: a["creator"] as string,
        manager: a["manager"] as string,
        managerFeeBps: managerFeeBps == null ? 0 : Number(managerFeeBps),
        platformFeeBps: platformFeeBps == null ? null : Number(platformFeeBps),
        keeperBps: keeperBps == null ? 0 : Number(keeperBps),
        keeperEscrow: keeperEscrow ?? "0x0000000000000000000000000000000000000000",
        unitSize: unitSize ?? 0n,
        name: name ?? "",
        symbol: symbol ?? "",
        constituents: [], // EMPTY — vault not bootstrapped at creation (populated in a later slice).
        recipeCommitment: recipeRoot ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      });
    }
    return out;
  }

  /** Single RegistryRebalanceVault getter, RESILIENT: returns null on revert so the tick never aborts. */
  private async tryRegistryRead<T>(
    vault: `0x${string}`,
    functionName:
      | "unitSize" | "name" | "symbol" | "managerFeeBps"
      | "keeperBps" | "keeperEscrow" | "platformFeeBps" | "recipeRoot",
  ): Promise<T | null> {
    try {
      return (await this.chain.publicClient.readContract({
        address: vault,
        abi: RegistryRebalanceVaultAbi,
        functionName,
      })) as T;
    } catch {
      return null;
    }
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

  // RootScheduled(newRoot, effectiveAt, tokens[], unitQty[], unitSize) carries the FULL recipe for data
  // availability, so a registry vault's constituents are reconstructable from logs alone. We index the
  // SCHEDULED recipe as the constituent set (the curator-published target); the live-held set is read
  // separately by the holdings API from heldTokens/holdingsOf. RootActivated carries no recipe (just the
  // root flip) so it is a no-op for constituents. EVERY decode/casing mirrors getVaultLifecycleLogs.
  async getRegistryRecipeLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RegistryConstituentsUpdate[]> {
    if (addresses.length === 0) return [];
    const set = new Set(addresses.map((a) => a.toLowerCase()));
    // Key rows by the Basket-stored (checksummed) address, not the raw lowercase `log.address`, or the
    // Constituent FK to Basket.vaultAddress violates / orphans on a case mismatch (the prior bug).
    const byCase = new Map(addresses.map((a) => [a.toLowerCase(), a]));
    // Last-write-wins within the range: a vault may schedule twice in one window; keep the latest by
    // (blockNumber, logIndex) so the constituent set reflects the most recent recipe.
    const latest = new Map<string, { ord: bigint; update: RegistryConstituentsUpdate }>();

    const logs = await this.chain.publicClient.getLogs({
      event: this.rootScheduledEvent,
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      if (!set.has(log.address.toLowerCase())) continue;
      const a = this.decodeWith(RegistryRebalanceVaultAbi, log);
      const tokens = (a["tokens"] as readonly string[]).map(String);
      const unitQty = a["unitQty"] as readonly bigint[];
      const update: RegistryConstituentsUpdate = {
        vaultAddress: byCase.get(log.address.toLowerCase()) ?? log.address,
        constituents: tokens.map((token, i) => ({ token, unitQty: unitQty[i]! })),
      };
      const ord = (log.blockNumber! << 32n) + BigInt(log.logIndex!);
      const key = log.address.toLowerCase();
      const prev = latest.get(key);
      if (!prev || ord > prev.ord) latest.set(key, { ord, update });
    }
    return [...latest.values()].map((v) => v.update);
  }

  // Genesis recipe: read the bootstrapped vault's custody set (heldTokens) and per-token claim backing
  // (holdingsOf). RESILIENT — a revert (e.g. not yet bootstrapped, or a pre-seam impl) yields [] so the
  // caller skips and the tick NEVER aborts (a throw here freezes the checkpoint — the known prior bug).
  // holdingsOf is read via multicall(allowFailure) and any failing token is treated as 0 / dropped.
  async readRegistryGenesis(vault: `0x${string}`): Promise<{ token: string; unitQty: bigint }[]> {
    let held: readonly `0x${string}`[];
    try {
      held = (await this.chain.publicClient.readContract({
        address: vault,
        abi: RegistryRebalanceVaultAbi,
        functionName: "heldTokens",
      })) as readonly `0x${string}`[];
    } catch {
      return [];
    }
    if (held.length === 0) return [];
    try {
      const results = await this.chain.publicClient.multicall({
        allowFailure: true,
        contracts: held.map((token) => ({
          address: vault,
          abi: RegistryRebalanceVaultAbi,
          functionName: "holdingsOf" as const,
          args: [token],
        })),
      });
      const out: { token: string; unitQty: bigint }[] = [];
      for (let i = 0; i < held.length; i++) {
        const r = results[i];
        // Drop a token whose backing read failed: a partial genesis is better than a throw, and the
        // next tick re-reads (the vault stays in the needs-genesis set until at least one token writes).
        if (r?.status === "success") out.push({ token: held[i]!, unitQty: r.result as bigint });
      }
      return out;
    } catch {
      return [];
    }
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

  async getVaultActivityLogs(
    addresses: `0x${string}`[],
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<ActivityEventRecord[]> {
    if (addresses.length === 0) return [];
    const out: ActivityEventRecord[] = [];

    const mintLogs = (await this.chain.publicClient.getLogs({
      address: addresses,
      event: this.createdEvent,
      fromBlock,
      toBlock,
    } as never)) as Log[];
    for (const log of mintLogs) {
      const a = ((log as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>;
      out.push({
        owner: a["creator"] as string,
        vaultAddress: getAddress(log.address),
        kind: "Mint",
        payload: { nUnits: (a["nUnits"] as bigint).toString(), minted: (a["minted"] as bigint).toString() },
        txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
        timestampMs: await this.tsOf(log.blockNumber!),
      });
    }

    const redeemLogs = (await this.chain.publicClient.getLogs({
      address: addresses,
      event: this.redeemedEvent,
      fromBlock,
      toBlock,
    } as never)) as Log[];
    for (const log of redeemLogs) {
      const a = ((log as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>;
      out.push({
        owner: a["redeemer"] as string,
        vaultAddress: getAddress(log.address),
        kind: "Redeem",
        payload: { amount: (a["amount"] as bigint).toString() },
        txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
        timestampMs: await this.tsOf(log.blockNumber!),
      });
    }

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

  // Meridian's own AUM fee. Currently-deployed managed/rebalance impls predate platformFeeBps(),
  // so a live read reverts — treat a missing/reverting getter as null and NEVER let it throw, or
  // the indexer tick aborts and the checkpoint freezes (no new vaults ever index).
  private async tryPlatformFeeBps(
    vault: `0x${string}`,
    abi: typeof ManagedVaultAbi | typeof ManagedRebalanceVaultAbi,
  ): Promise<number | null> {
    try {
      const result = await this.chain.publicClient.readContract({
        address: vault,
        abi,
        functionName: "platformFeeBps",
      });
      return Number(result);
    } catch {
      return null;
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
  private static readonly MAX_RANGE = 9_000n;

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

    const [basic, managed, committed, rebalance, registry] = await Promise.all([
      this.reader.getBasketCreated(from, to),
      this.reader.getManagedBasketCreated(from, to),
      this.reader.getCommittedBasketCreated(from, to),
      this.reader.getRebalanceBasketCreated(from, to),
      this.reader.getRegistryIndexCreated(from, to),
    ]);
    for (const e of basic) await this.repo.applyBasketCreated(e);
    for (const e of managed) await this.repo.applyManagedBasketCreated(e);
    for (const e of committed) await this.repo.applyCommittedBasketCreated(e);
    for (const e of rebalance) await this.repo.applyRebalanceBasketCreated(e);
    for (const e of registry) await this.repo.applyRegistryIndexCreated(e);

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

    // Registry constituents: (1) RootScheduled recipe logs in this range replace the target set; (2) any
    // registry vault still lacking constituents is populated from its post-bootstrap genesis read. Both
    // skip an EMPTY set so a malformed/empty recipe or an unbootstrapped/reverting read never wipes rows.
    let registryConstituentCount = 0;
    const regAddresses = (await this.repo.getRegistryVaultAddresses()) as `0x${string}`[];
    if (regAddresses.length > 0) {
      const recipeUpdates = await this.reader.getRegistryRecipeLogs(regAddresses, from, to);
      for (const u of recipeUpdates) {
        if (u.constituents.length === 0) continue;
        await this.repo.replaceRegistryConstituents(u);
        registryConstituentCount++;
      }
    }
    // Genesis trigger (b): re-check registry vaults with empty constituents each tick and populate once
    // bootstrapped (heldTokens non-empty). Chosen over a bootstrap-event trigger because `Created` is
    // emitted by create/settleCreate too (not bootstrap-specific) and carries NO recipe, so the on-chain
    // heldTokens/holdingsOf read is required either way; this form is self-healing (retries if the
    // indexer was down at the bootstrap block) and bounded (a vault leaves the set once populated).
    for (const vault of (await this.repo.getRegistryVaultsNeedingGenesis()) as `0x${string}`[]) {
      // Prefer the recipe persisted at deploy (available immediately, pre-bootstrap); fall back to the
      // on-chain post-bootstrap read (heldTokens/holdingsOf) for vaults created before that path existed.
      let constituents = await this.repo.getGenesisConstituents(vault);
      if (constituents.length === 0) constituents = await this.reader.readRegistryGenesis(vault);
      if (constituents.length === 0) continue;
      await this.repo.replaceRegistryConstituents({ vaultAddress: vault, constituents });
      registryConstituentCount++;
    }

    // The forward-queue registry lowercases its vault keys, but ForwardTicket.vaultAddress FKs to the
    // Basket's stored (checksummed) address — pass the stored case (else the upsert violates the FK and
    // throws the whole tick). Skip queues whose vault isn't indexed yet (no Basket row to point at).
    const allVaults = (await this.repo.getAllVaultAddresses()) as `0x${string}`[];
    const byCase = new Map(allVaults.map((a) => [a.toLowerCase(), a]));

    let forwardCount = 0;
    await this.forwardQueues.refresh();
    for (const { vault, queue } of this.forwardQueues.pairs()) {
      const storedVault = byCase.get(vault.toLowerCase());
      if (!storedVault) continue;
      const evs = await this.reader.getForwardQueueLogs(queue, storedVault, from, to);
      for (const e of evs) await this.repo.applyForwardEvent(e);
      forwardCount += evs.length;
    }

    // In-kind mint/redeem → per-account activity feed (every vault type emits Created/Redeemed).
    const activity = await this.reader.getVaultActivityLogs(allVaults, from, to);
    let activityCount = 0;
    for (const e of activity) {
      // Non-critical feed: a single bad row must never freeze the checkpoint (which would also stall
      // NAV/forward indexing). Log and continue.
      try {
        await this.repo.applyActivityEvent(e);
        activityCount++;
      } catch (err) {
        this.logger.warn(`activity event skipped (${e.txHash}:${e.logIndex}): ${(err as Error).message}`);
      }
    }

    await this.repo.setCheckpoint(this.chainId, to);
    const n =
      basic.length + managed.length + committed.length + rebalance.length + registry.length +
      lifecycleCount + registryConstituentCount + forwardCount + activityCount;
    this.logger.debug(`indexer tick (${from}, ${to}] -> ${n} events`);
    return n;
  }
}
