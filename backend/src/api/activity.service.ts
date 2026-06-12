import { Injectable } from "@nestjs/common";
import type { ActivityEvent } from "@meridian/sdk";
import { IndexerRepository } from "../indexer/indexer.repository.js";

type ActivityRow = {
  vaultAddress: string;
  owner: string;
  kind: string;
  payload: unknown;
  txHash: string;
  timestamp: Date;
  basket?: { symbol: string } | null;
};

const KIND_WIRE: Record<string, ActivityEvent["kind"]> = {
  Mint: "mint",
  Redeem: "redeem",
  ForwardCreateRequested: "forward-create",
  ForwardRedeemRequested: "forward-redeem",
  ForwardPartialFill: "forward-fill",
  ForwardSettled: "forward-settle",
  ForwardCancelled: "forward-cancel",
};

const DEFAULT_LIMIT = 100;

@Injectable()
export class ActivityService {
  constructor(private readonly repo: IndexerRepository) {}

  async getAccountActivity(owner: string, limit = DEFAULT_LIMIT): Promise<ActivityEvent[]> {
    const rows = (await this.repo.getActivityForOwner(owner, limit)) as ActivityRow[];
    return rows.map((r) => ({
      vaultAddress: r.vaultAddress,
      symbol: r.basket?.symbol ?? "",
      owner: r.owner,
      kind: KIND_WIRE[r.kind] ?? "mint",
      payload: (r.payload ?? {}) as Record<string, string>,
      txHash: r.txHash,
      timestampMs: r.timestamp.getTime(),
    }));
  }
}
