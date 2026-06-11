import { Injectable } from "@nestjs/common";
import {
  type MintQuoteResponse,
  type TxPlan,
  type TxStep,
  auctionBidTxRequestSchema,
  auctionOpenTxRequestSchema,
  auctionSetExecModeTxRequestSchema,
  curatorActivateTxRequestSchema,
  curatorScheduleTxRequestSchema,
  deployTxRequestSchema,
  forwardCancelTxRequestSchema,
  forwardCreateTxRequestSchema,
  forwardRedeemTxRequestSchema,
  keeperRecordTxRequestSchema,
  keeperSettleTxRequestSchema,
  mintFinalizeRequestSchema,
  mintQuoteRequestSchema,
  mintTxRequestSchema,
  redeemTxRequestSchema,
} from "@meridian/sdk";
import type { z } from "zod";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { AvailabilityService } from "../api/availability.service.js";
import type { ActionResult, PlanStep } from "./action-registry.js";
import { TxSimulator } from "./tx-simulator.js";
import { buildDeploy, type DeployDeps, type DeployTxRequest } from "./actions/deploy.js";
import {
  buildMintAny,
  finalizeMintPermit,
  type MintDeps,
  quoteMint,
} from "./actions/mint.js";
import { buildRedeem, type RedeemDeps } from "./actions/redeem.js";
import {
  buildForwardCancel,
  buildForwardCreate,
  buildForwardRedeem,
  type ForwardDeps,
} from "./actions/forward.js";
import { buildCuratorActivate, buildCuratorSchedule } from "./actions/curator.js";
import { buildKeeperRecord, buildKeeperSettle, type KeeperDeps } from "./actions/keeper.js";
import {
  buildAuctionBid,
  buildAuctionOpen,
  buildAuctionSetExecMode,
  type AuctionDeps,
} from "./actions/auction.js";

/**
 * Assembles transaction plans from the leaf action modules: resolves shared deps, runs the
 * protocol/market availability gate, builds the action's steps, and per-step simulates the calldata.
 * Engines propose; the immutable vault disposes — this builder is purely a calldata + gate assembler.
 */
@Injectable()
export class TxPlanBuilder {
  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
    private readonly prisma: PrismaService,
    private readonly tokenMeta: TokenMetadataService,
    private readonly simulator: TxSimulator,
    private readonly availability: AvailabilityService,
    private readonly config: ConfigService,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly signer: PayloadSignerService,
    private readonly forwardQueues: ForwardQueueRegistry,
  ) {}

  private chainId(): number {
    return Number(this.config.get("CHAIN_ID"));
  }

  private mintDeps(): MintDeps {
    return {
      prisma: this.prisma as unknown as MintDeps["prisma"],
      publicClient: this.chain.publicClient as unknown as MintDeps["publicClient"],
      meta: this.tokenMeta,
      chainId: this.chainId(),
      nowSec: Math.floor(Date.now() / 1000),
    };
  }

  private redeemDeps(): RedeemDeps {
    return { prisma: this.prisma as unknown as RedeemDeps["prisma"] };
  }

  private forwardDeps(): ForwardDeps {
    return {
      prisma: this.prisma as unknown as ForwardDeps["prisma"],
      publicClient: this.chain.publicClient as unknown as ForwardDeps["publicClient"],
      meta: this.tokenMeta,
      forwardQueues: this.forwardQueues,
    };
  }

  private keeperDeps(): KeeperDeps {
    return { registry: this.registry, rebVault: this.rebVault, signer: this.signer };
  }

  private auctionDeps(): AuctionDeps {
    return {
      publicClient: this.chain.publicClient as unknown as AuctionDeps["publicClient"],
      meta: this.tokenMeta,
      registry: this.registry,
    };
  }

  private deployDeps(): DeployDeps {
    const cloneFactory = this.registry.address("CloneFactory");
    if (!cloneFactory) throw new Error("not-deployed: CloneFactory is not registered");
    return { cloneFactory };
  }

  async mintQuote(vault: string, req: z.infer<typeof mintQuoteRequestSchema>): Promise<MintQuoteResponse> {
    return quoteMint(this.mintDeps(), vault, req);
  }

  async mint(vault: string, req: z.infer<typeof mintTxRequestSchema>): Promise<TxPlan> {
    const account = req.account ?? "";
    const avail = await this.availability.availability(vault, account || null);
    const item = avail.items.find((i) => i.action === "mint");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    return this.toTxPlan(await buildMintAny(this.mintDeps(), vault, { ...req, account }), account);
  }

  async finalizeMint(vault: string, req: z.infer<typeof mintFinalizeRequestSchema>): Promise<TxPlan> {
    // hexString in the SDK infers to plain string; the action's PermitPost brands r/s as `0x${string}`.
    // The validated DTO already guarantees 0x-hex, so the cast is sound.
    const args = req as Parameters<typeof finalizeMintPermit>[2];
    return this.toTxPlan(await finalizeMintPermit(this.mintDeps(), vault, args), req.account);
  }

  async redeem(vault: string, req: z.infer<typeof redeemTxRequestSchema>): Promise<TxPlan> {
    // IRON RULE: in-kind redeem is never gated; the availability call is for surface consistency only.
    await this.availability.availability(vault, req.account || null);
    return this.toTxPlan(await buildRedeem(this.redeemDeps(), vault, req), req.account);
  }

  async forwardCreate(vault: string, req: z.infer<typeof forwardCreateTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "forwardCreate");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildForwardCreate(this.forwardDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async forwardRedeem(vault: string, req: z.infer<typeof forwardRedeemTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "forwardRedeem");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildForwardRedeem(this.forwardDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async forwardCancel(vault: string, req: z.infer<typeof forwardCancelTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "forwardCancel");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildForwardCancel(this.forwardDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async curatorSchedule(vault: string, req: z.infer<typeof curatorScheduleTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "curatorSchedule");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    return this.toTxPlan(buildCuratorSchedule(vault, req), req.account);
  }

  async curatorActivate(vault: string, req: z.infer<typeof curatorActivateTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "curatorActivate");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    return this.toTxPlan(buildCuratorActivate(vault), req.account);
  }

  async keeperRecord(vault: string, req: z.infer<typeof keeperRecordTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "keeperRecord");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildKeeperRecord(this.keeperDeps(), vault), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async keeperSettle(vault: string, req: z.infer<typeof keeperSettleTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "keeperSettle");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildKeeperSettle(this.keeperDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async auctionOpen(vault: string, req: z.infer<typeof auctionOpenTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "auctionOpen");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(buildAuctionOpen(this.auctionDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async auctionBid(vault: string, req: z.infer<typeof auctionBidTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "auctionBid");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(await buildAuctionBid(this.auctionDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async auctionSetExecMode(vault: string, req: z.infer<typeof auctionSetExecModeTxRequestSchema>): Promise<TxPlan> {
    const avail = await this.availability.availability(vault, req.account || null);
    const item = avail.items.find((i) => i.action === "auctionSetExecMode");
    if (item && !item.enabled) return this.gatedPlan(item.reason);
    try {
      return this.toTxPlan(buildAuctionSetExecMode(this.auctionDeps(), vault, req), req.account);
    } catch (err) {
      if (String((err as Error)?.message).startsWith("not-deployed")) return this.gatedPlan("not-deployed");
      throw err;
    }
  }

  async deploy(req: z.infer<typeof deployTxRequestSchema>): Promise<TxPlan> {
    // Deploy is not vault-scoped. If CloneFactory is absent, surface a coarse "halted" gate.
    let deps: DeployDeps;
    try {
      deps = this.deployDeps();
    } catch {
      return this.gatedPlan("not-deployed");
    }
    // hexString fields infer to plain string; buildDeploy brands them — the validated DTO guarantees hex.
    return this.toTxPlan(await buildDeploy(deps, req as DeployTxRequest), req.account);
  }

  /**
   * gateStateSchema only carries none/estimated/frozen/halted, so we map "frozen"→"frozen" and
   * collapse every other disabled reason to "halted" as a coarse backstop. The FE capabilities layer
   * already surfaces the precise per-action reason to users before they ever reach this plan.
   */
  private gatedPlan(availReason: string): TxPlan {
    return {
      chainId: this.chainId(),
      gate: { gated: true, reason: availReason === "frozen" ? "frozen" : "halted" },
      steps: [],
      finalize: null,
    };
  }

  private async toTxPlan(result: ActionResult, account: string): Promise<TxPlan> {
    const steps = await Promise.all(result.steps.map((step) => this.toTxStep(step, account)));
    return {
      chainId: this.chainId(),
      gate: { gated: false, reason: "none" },
      steps,
      finalize: result.finalize ?? null,
    };
  }

  private async toTxStep(step: PlanStep, account: string): Promise<TxStep> {
    if (step.kind === "sign712") {
      // PlanStep.typedData is `unknown`; the action module emits the EIP-712 shape the TxStep schema wants.
      type SignStepWire = Extract<TxStep, { kind: "sign712" }>;
      return {
        kind: "sign712",
        token: step.token,
        typedData: step.typedData as SignStepWire["typedData"],
        label: step.label,
        summary: step.summary,
      };
    }
    // A step that depends on a not-yet-sent approval can't be simulated pre-approval, so we report it
    // honestly as simulated:false. Standalone approve/redeem/deploy steps simulate cleanly.
    const simulated = step.needsPriorApproval
      ? false
      : await this.simulator.simulate({ to: step.to, data: step.data, value: step.value }, account);
    return {
      kind: step.kind,
      to: step.to,
      data: step.data,
      value: step.value,
      contractName: step.contractName,
      label: step.label,
      summary: step.summary,
      simulated,
    };
  }
}
