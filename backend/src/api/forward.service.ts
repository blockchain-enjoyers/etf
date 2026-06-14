import { Injectable, Logger } from "@nestjs/common";
import { erc20Abi } from "viem";
import type {
  ForwardTicket,
  ForwardQueue,
  ForwardQueueFees,
  ForwardHistory,
  QueueCapacity,
  SettleGateStatus,
  SettleGateGuard,
} from "@meridian/sdk";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ForwardCashQueueReader } from "../contracts/forward-cash-queue.reader.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { ChainService } from "../chain/chain.service.js";
import { BasketNavObserverReader } from "../contracts/basket-nav-observer.reader.js";
import { AggSourcePayloads } from "./agg-source-payloads.js";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { GATE_GUARD_IDS, decodeGateRevert, guardForError } from "./settle-gate-decoder.js";

const BPS = 10_000n;

type TicketRow = {
  ticketId: number;
  vaultAddress: string;
  owner: string;
  kind: string;
  amount: { toFixed(n: number): string };
  remaining: { toFixed(n: number): string };
  status: string;
  cutoff: Date;
  createdAt: Date;
};

@Injectable()
export class ForwardService {
  private readonly logger = new Logger(ForwardService.name);

  constructor(
    private readonly repo: IndexerRepository,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly forward: ForwardCashQueueReader,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly chain: ChainService,
    private readonly observer: BasketNavObserverReader,
    private readonly aggSourcePayloads: AggSourcePayloads,
  ) {}

  async getTickets(vault: string, owner?: string): Promise<ForwardTicket[]> {
    const rows = (await this.repo.getForwardTickets(vault, owner)) as TicketRow[];
    const dec = (await this.cashLeg(this.forwardQueues.queueFor(vault))).decimals;
    return rows.map((r) => this.toWire(r, dec));
  }

  /** OPEN (pending/partial) forward tickets for one owner across ALL vaults — Portfolio queue section. */
  async getAccountTickets(owner: string): Promise<ForwardTicket[]> {
    const rows = (await this.repo.getOpenForwardTicketsForOwner(owner)) as TicketRow[];
    const decByVault = await this.cashDecimalsByVault(rows.map((r) => r.vaultAddress));
    return rows.map((r) => this.toWire(r, decByVault.get(r.vaultAddress.toLowerCase()) ?? 18));
  }

  async getQueue(vault: string): Promise<ForwardQueue> {
    const queue = this.forwardQueues.queueFor(vault);
    const pending = (await this.repo.getPendingForwardTickets(vault)) as TicketRow[];
    const capacity = await this.capacity(vault, queue, pending);
    const fees = await this.forwardFees(vault, queue);
    const cash = await this.cashLeg(queue);
    const tickets = pending.map((r) => this.toWire(r, cash.decimals));
    return { queueAddress: queue ?? null, cashToken: cash.token, cashDecimals: cash.decimals, tickets, capacity, fees };
  }

  /** Cash-leg decimals per distinct vault (one queue read each) — for the cross-vault account tickets. */
  private async cashDecimalsByVault(vaults: string[]): Promise<Map<string, number>> {
    const distinct = [...new Set(vaults.map((v) => v.toLowerCase()))];
    const out = new Map<string, number>();
    await Promise.all(
      distinct.map(async (v) => {
        out.set(v, (await this.cashLeg(this.forwardQueues.queueFor(v))).decimals);
      }),
    );
    return out;
  }

  /** The queue's stable (cash) token + its decimals — the cash leg the UI parses create amounts in. */
  private async cashLeg(queue: string | undefined): Promise<{ token: string | null; decimals: number }> {
    if (!queue) return { token: null, decimals: 18 };
    try {
      const token = await this.forward.stable(queue as `0x${string}`);
      const decimals = Number(
        await this.chain.publicClient.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
      );
      return { token, decimals };
    } catch {
      return { token: null, decimals: 18 };
    }
  }

  /**
   * Disclose a registry queue's fixed USDG create/redeem fees so the FE can show honest net amounts.
   * Registry settle pulls flatCreateFee (create) and deducts flatRedeemFee (redeem) in USDG; the
   * request CALLDATA is identical to managed, only this disclosure differs. null for managed queues.
   * RESILIENCE: every read is wrapped — the deployed impl may predate these getters — and this never
   * throws; getQueue must succeed even with a stale contract.
   */
  private async forwardFees(
    vault: string,
    queue: string | undefined,
  ): Promise<ForwardQueueFees | null> {
    if (!queue) return null;
    let isRegistry = false;
    try {
      isRegistry = await this.forward.isRegistry(queue as `0x${string}`);
    } catch {
      isRegistry = false;
    }
    if (!isRegistry) return null;

    const v = vault as `0x${string}`;
    let flatCreateFee = 0n;
    let flatRedeemFee = 0n;
    let feeToken = "0x0000000000000000000000000000000000000000";
    try {
      flatCreateFee = await this.rebVault.flatCreateFee(v);
    } catch {
      flatCreateFee = 0n;
    }
    try {
      flatRedeemFee = await this.rebVault.flatRedeemFee(v);
    } catch {
      flatRedeemFee = 0n;
    }
    try {
      feeToken = await this.rebVault.feeToken(v);
    } catch {
      feeToken = "0x0000000000000000000000000000000000000000";
    }

    // Defensive: the constructor enforces stable == feeToken on a real deploy (else FeeTokenMismatch),
    // so a mismatch here means a stale/inconsistent contract — warn, never throw.
    try {
      const stable = await this.forward.stable(queue as `0x${string}`);
      if (stable.toLowerCase() !== feeToken.toLowerCase()) {
        this.logger.warn(
          `registry queue ${queue} stable ${stable} != vault ${vault} feeToken ${feeToken}`,
        );
      }
    } catch {
      // stable() unreadable on a stale impl — skip the cross-check, keep the disclosed fees.
    }

    // Fee-token decimals so the UI can format the fee (USDG 18-dec, MockUSDC 6-dec). Default 18 on read fail.
    let feeDecimals = 18;
    try {
      feeDecimals = Number(
        await this.chain.publicClient.readContract({ address: feeToken as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
      );
    } catch {
      feeDecimals = 18;
    }

    return {
      isRegistry: true,
      feeToken,
      feeDecimals,
      flatCreateFee: flatCreateFee.toString(),
      flatRedeemFee: flatRedeemFee.toString(),
    };
  }

  async getHistory(vault: string): Promise<ForwardHistory> {
    const rows = (await this.repo.getForwardHistory(vault)) as {
      kind: string; ticketId: number; txHash: string; timestamp: Date; payload: Record<string, string>;
    }[];
    return {
      items: rows.map((r) => ({
        kind: r.kind as ForwardHistory["items"][number]["kind"],
        id: r.ticketId,
        txHash: r.txHash,
        timestampMs: r.timestamp.getTime(),
        payload: r.payload ?? {},
      })),
    };
  }

  /**
   * Read-only settle-gate readiness for the UI. Calls settleGateView; on success every guard is ok
   * and navPerShare is the struck open print. On a custom-error revert, the matching guard is blocked
   * with the error name; an unrecognised revert blocks every guard as "unavailable". NEVER throws.
   * IRON RULE: estimated:true always — this is decision-only, never a settlement price.
   */
  async getGateStatus(vault: string): Promise<SettleGateStatus> {
    const queue = this.forwardQueues.queueFor(vault);
    const allBlocked = (reason: string): SettleGateGuard[] =>
      GATE_GUARD_IDS.map((id) => ({ id, ok: false, reason }));

    if (!queue) {
      return { open: false, navPerShare: null, twap: null, guards: allBlocked("unavailable"), estimated: true };
    }

    const twap = await this.readTwap(vault as `0x${string}`);

    let held: `0x${string}`[];
    try {
      held = await this.rebVault.heldTokens(vault as `0x${string}`);
    } catch {
      return { open: false, navPerShare: null, twap, guards: allBlocked("unavailable"), estimated: true };
    }
    const payloads = await this.aggSourcePayloads.payloadsFor(held);

    try {
      const { result: navPerShare } = await this.chain.publicClient.simulateContract({
        address: queue as `0x${string}`,
        abi: ForwardCashQueueAbi,
        functionName: "settleGateView",
        args: [held, payloads],
      });
      return {
        open: true,
        navPerShare: navPerShare.toString(),
        twap,
        guards: GATE_GUARD_IDS.map((id) => ({ id, ok: true, reason: null })),
        estimated: true,
      };
    } catch (err) {
      const errorName = decodeGateRevert(err);
      const blockedGuard = errorName ? guardForError(errorName) : undefined;
      if (!blockedGuard) {
        return { open: false, navPerShare: null, twap, guards: allBlocked("unavailable"), estimated: true };
      }
      return {
        open: false,
        navPerShare: null,
        twap,
        guards: GATE_GUARD_IDS.map((id) =>
          id === blockedGuard ? { id, ok: false, reason: errorName! } : { id, ok: true, reason: null },
        ),
        estimated: true,
      };
    }
  }

  private async readTwap(vault: `0x${string}`): Promise<string | null> {
    try {
      // Per-vault observer: read it off the vault's own queue. The registered singleton would be the
      // wrong TWAP window once more than one forward vault exists.
      const queue = this.forwardQueues.queueFor(vault);
      if (!queue) return null;
      const observer = await this.forward.observer(queue as `0x${string}`);
      const window = 86_400n; // 1 day; the FE band is decision-only
      const { twap, count } = await this.observer.consult(vault, window, observer);
      return count > 0n ? twap.toString() : null;
    } catch {
      return null;
    }
  }

  private toWire(r: TicketRow, cashDecimals = 18): ForwardTicket {
    return {
      id: r.ticketId,
      vaultAddress: r.vaultAddress,
      owner: r.owner,
      kind: r.kind === "Redeem" ? "redeem" : "create",
      amountRaw: r.amount.toFixed(0),
      remainingRaw: r.remaining.toFixed(0),
      cashDecimals,
      status: r.status.toLowerCase() as ForwardTicket["status"],
      cutoffMs: r.cutoff.getTime(),
      createdAtMs: r.createdAt.getTime(),
    };
  }

  private async capacity(
    vault: string,
    queue: string | undefined,
    pending: TicketRow[],
  ): Promise<QueueCapacity> {
    const pendingCreateCash = pending
      .filter((t) => t.kind !== "Redeem")
      .reduce((acc, t) => acc + BigInt(t.remaining.toFixed(0)), 0n)
      .toString();
    const pendingRedeemShares = pending
      .filter((t) => t.kind === "Redeem")
      .reduce((acc, t) => acc + BigInt(t.remaining.toFixed(0)), 0n)
      .toString();
    if (!queue) {
      return { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash, pendingRedeemShares };
    }
    let bps = 0n;
    try {
      bps = await this.forward.maxCreateFlowBps(queue as `0x${string}`);
    } catch {
      bps = 0n;
    }
    if (bps === 0n) {
      return { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash, pendingRedeemShares };
    }
    let supply = 0n;
    try {
      supply = await this.rebVault.totalSupply(vault as `0x${string}`);
    } catch {
      supply = 0n;
    }
    const windowCapShares = ((supply * bps) / BPS).toString();
    return {
      maxCreateFlowBps: Number(bps),
      windowCapShares,
      pendingCreateCash,
      pendingRedeemShares,
    };
  }
}
