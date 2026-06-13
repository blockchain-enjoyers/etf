import { Injectable, Logger } from "@nestjs/common";
import { ForwardCashQueueAbi, RegistryRebalanceVaultAbi } from "@meridian/contracts";
import type { EnableParams } from "../api/forward-enable.params.js";
import { ForwardEnableWriter } from "../contracts/forward-enable.writer.js";
import { CapabilityRegistry, type Capability } from "../contracts/capability-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { PrismaService } from "../persistence/prisma.service.js";

type Addr = `0x${string}`;

/**
 * Async orchestration for "enable cash settlement": deploys + wires a ForwardCashQueue
 * on-chain with the platform owner key, idempotently, then flips the DB row to Live.
 * Each step is recoverable — once the queue is deployed its address is persisted before
 * any config write, so a re-run of a Failed row resumes without redeploying. Errors are
 * captured to the DB (status Failed) and NOT rethrown, so pg-boss does not auto-retry;
 * the user retries via the request endpoint.
 */
@Injectable()
export class ForwardEnableHandler {
  private readonly logger = new Logger(ForwardEnableHandler.name);

  constructor(
    private readonly repo: IndexerRepository,
    private readonly writer: ForwardEnableWriter,
    private readonly registry: CapabilityRegistry,
    private readonly managedReader: ManagedRebalanceVaultReader,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly chain: ChainService,
    private readonly prisma: PrismaService,
  ) {}

  private require(capability: Capability): Addr {
    const addr = this.registry.address(capability);
    if (!addr) throw new Error(`missing capability ${capability}`);
    return addr;
  }

  async run(vault: string): Promise<void> {
    const cfg = await this.repo.getForwardQueueConfig(vault);
    if (!cfg) return;
    const p = cfg.params as unknown as EnableParams;
    const v = vault as Addr;

    try {
      await this.repo.setForwardQueueStatus(vault, "Wiring", { step: "start" });

      const nav = this.require("FairValueNAV");
      const observer = this.require("BasketNavObserver");
      const keeperModule = this.require("KeeperModule");
      const aggregator = this.require("PriceAggregator");
      const weekday = this.require("UniversalSignedSource");
      const weekend = this.require("UniversalSignedSourceWeekend");
      const usdg = this.require("USDG");
      const refQueue = this.require("ForwardCashQueue");

      const router = (await this.chain.publicClient.readContract({
        address: refQueue,
        abi: ForwardCashQueueAbi as never,
        functionName: "router",
      })) as Addr;
      const pegFeed = (await this.chain.publicClient.readContract({
        address: refQueue,
        abi: ForwardCashQueueAbi as never,
        functionName: "pegFeed",
      })) as Addr;

      const owner = this.chain.account?.address as Addr | undefined;
      if (!owner) throw new Error("no signer account (KEEPER_PRIVATE_KEY)");

      const basket = await this.prisma.basket.findUnique({
        where: { vaultAddress: vault },
        select: { vaultType: true },
      });
      const isRegistry = basket?.vaultType === "Registry";

      let heldTokens: Addr[];
      let stable: Addr;
      if (isRegistry) {
        heldTokens = (await this.chain.publicClient.readContract({
          address: v,
          abi: RegistryRebalanceVaultAbi as never,
          functionName: "heldTokens",
        })) as Addr[];
        // Registry queue constructor reverts FeeTokenMismatch unless stable == vault.feeToken.
        stable = (await this.chain.publicClient.readContract({
          address: v,
          abi: RegistryRebalanceVaultAbi as never,
          functionName: "feeToken",
        })) as Addr;
      } else {
        heldTokens = await this.managedReader.heldTokens(v);
        stable = usdg;
      }

      const txHashes: string[] = [];

      await this.repo.setForwardQueueStatus(vault, "Wiring", { step: "sources" });
      for (const token of heldTokens) {
        const h = await this.writer.ensureSources(aggregator, token, weekday, weekend);
        if (h) txHashes.push(h);
      }

      await this.repo.setForwardQueueStatus(vault, "Wiring", { step: "deploy" });
      const existing = cfg.queueAddress as Addr | null | undefined;
      const queue =
        existing ??
        (await this.writer.deployQueue({
          vault: v,
          stable,
          navEngine: nav,
          observer,
          keeperModule,
          router,
          pegFeed,
          owner,
        }));
      if (!existing) {
        // Persist the address before any config write so a later failure resumes without redeploy.
        await this.repo.setForwardQueueStatus(vault, "Wiring", { queueAddress: queue, step: "config", txHashes });
      }

      txHashes.push(
        await this.writer.setGateParams(queue, {
          minN: p.minPrints,
          win: p.twapWindowSec,
          twBps: p.twapBandBps,
          pegBps: p.pegBandBps,
          pegMaxAge: p.pegMaxAgeSec,
        }),
      );
      txHashes.push(await this.writer.setG1Refs(queue, aggregator, weekday));
      txHashes.push(await this.writer.setKeeperTip(queue, BigInt(p.keeperTip)));
      txHashes.push(await this.writer.setSpreadBps(queue, p.spreadBps));
      txHashes.push(await this.writer.setCapacity(queue, p.capacityBps));
      txHashes.push(await this.writer.setCutoffDelay(queue, p.cutoffDelaySec));

      await this.repo.setForwardQueueStatus(vault, "Wiring", { queueAddress: queue, step: "executor", txHashes });
      const e = await this.writer.ensureExecutor(keeperModule, queue);
      if (e) txHashes.push(e);

      if (isRegistry) {
        await this.repo.setForwardQueueStatus(vault, "Wiring", { queueAddress: queue, step: "settler", txHashes });
        const s = await this.writer.ensureSettler(v, queue);
        if (s) txHashes.push(s);
      }

      if (p.keeperBps > 0) {
        await this.repo.setForwardQueueStatus(vault, "Wiring", { queueAddress: queue, step: "keeperBps", txHashes });
        txHashes.push(await this.writer.setKeeperBps(v, p.keeperBps));
      }

      await this.repo.setForwardQueueStatus(vault, "Live", { queueAddress: queue, txHashes });
      await this.forwardQueues.refresh(true);
      this.logger.log(`forward-enable ${vault} -> Live (queue=${queue})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.repo.setForwardQueueStatus(vault, "Failed", { error: msg });
      this.logger.error(`forward-enable ${vault} failed: ${msg}`);
    }
  }
}
