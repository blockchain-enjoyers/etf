import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type MintQuoteResponse,
  type TxPlan,
  type DeployPreview,
  auctionBidTxRequestSchema,
  auctionOpenTxRequestSchema,
  auctionSetExecModeTxRequestSchema,
  curatorActivateTxRequestSchema,
  curatorScheduleTxRequestSchema,
  deployTxRequestSchema,
  faucetTxRequestSchema,
  forwardCancelTxRequestSchema,
  forwardCreateTxRequestSchema,
  forwardRedeemTxRequestSchema,
  keeperRecordTxRequestSchema,
  keeperSettleTxRequestSchema,
  mintFinalizeRequestSchema,
  mintQuoteRequestSchema,
  mintTxRequestSchema,
  previewDeployRequestSchema,
  redeemTxRequestSchema,
  registryBatchWrapTxRequestSchema,
  registryBootstrapTxRequestSchema,
  registryCreateTxRequestSchema,
  registryRedeemTxRequestSchema,
  registrySetOperatorTxRequestSchema,
  registryUnwrapTxRequestSchema,
  registryWrapTxRequestSchema,
} from "@meridian/sdk";
import { TxPlanBuilder } from "./tx-plan.builder.js";
import { PreviewDeployService } from "./preview-deploy.service.js";
import { AuctionStatusService } from "../api/auction-status.service.js";

/** nestjs-zod DTO classes wrap the SDK request schemas for validation + Swagger generation. */
export class MintQuoteDto extends createZodDto(mintQuoteRequestSchema) {}
export class MintTxDto extends createZodDto(mintTxRequestSchema) {}
export class MintFinalizeDto extends createZodDto(mintFinalizeRequestSchema) {}
export class RedeemTxDto extends createZodDto(redeemTxRequestSchema) {}
export class DeployTxDto extends createZodDto(deployTxRequestSchema) {}
export class PreviewDeployDto extends createZodDto(previewDeployRequestSchema) {}
export class ForwardCreateTxDto extends createZodDto(forwardCreateTxRequestSchema) {}
export class ForwardRedeemTxDto extends createZodDto(forwardRedeemTxRequestSchema) {}
export class ForwardCancelTxDto extends createZodDto(forwardCancelTxRequestSchema) {}
export class CuratorScheduleTxDto extends createZodDto(curatorScheduleTxRequestSchema) {}
export class CuratorActivateTxDto extends createZodDto(curatorActivateTxRequestSchema) {}
export class KeeperRecordTxDto extends createZodDto(keeperRecordTxRequestSchema) {}
export class KeeperSettleTxDto extends createZodDto(keeperSettleTxRequestSchema) {}
export class AuctionOpenTxDto extends createZodDto(auctionOpenTxRequestSchema) {}
export class AuctionBidTxDto extends createZodDto(auctionBidTxRequestSchema) {}
export class AuctionSetExecModeTxDto extends createZodDto(auctionSetExecModeTxRequestSchema) {}
export class RegistryWrapTxDto extends createZodDto(registryWrapTxRequestSchema) {}
export class RegistryBatchWrapTxDto extends createZodDto(registryBatchWrapTxRequestSchema) {}
export class RegistryUnwrapTxDto extends createZodDto(registryUnwrapTxRequestSchema) {}
export class RegistrySetOperatorTxDto extends createZodDto(registrySetOperatorTxRequestSchema) {}
export class RegistryBootstrapTxDto extends createZodDto(registryBootstrapTxRequestSchema) {}
export class RegistryCreateTxDto extends createZodDto(registryCreateTxRequestSchema) {}
export class RegistryRedeemTxDto extends createZodDto(registryRedeemTxRequestSchema) {}
export class FaucetTxDto extends createZodDto(faucetTxRequestSchema) {}

@ApiTags("tx")
@Controller()
export class TxController {
  constructor(
    private readonly builder: TxPlanBuilder,
    private readonly auctionStatus: AuctionStatusService,
    private readonly preview: PreviewDeployService,
  ) {}

  @Post("baskets/:id/mint-quote")
  @ApiOperation({ summary: "Quote an in-kind mint (deposit set + estimated USD value)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  mintQuote(@Param("id") id: string, @Body() body: MintQuoteDto): Promise<MintQuoteResponse> {
    return this.builder.mintQuote(id, body);
  }

  @Post("baskets/:id/tx/mint")
  @ApiOperation({ summary: "Build an in-kind mint plan (permit or approve path) + availability gate" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  mint(@Param("id") id: string, @Body() body: MintTxDto): Promise<TxPlan> {
    return this.builder.mint(id, body);
  }

  @Post("baskets/:id/tx/mint/finalize")
  @ApiOperation({ summary: "Finalize a permit-path mint from posted EIP-2612 signatures (1 tx)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  finalizeMint(@Param("id") id: string, @Body() body: MintFinalizeDto): Promise<TxPlan> {
    return this.builder.finalizeMint(id, body);
  }

  @Post("baskets/:id/tx/redeem")
  @ApiOperation({ summary: "Build an in-kind redeem plan (unconditional, never gated)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  redeem(@Param("id") id: string, @Body() body: RedeemTxDto): Promise<TxPlan> {
    return this.builder.redeem(id, body);
  }

  @Post("baskets/:id/tx/registry/wrap")
  @ApiOperation({ summary: "Build a registry wrap plan (approve constituent + wrap → ERC-6909 claim)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryWrap(@Param("id") id: string, @Body() body: RegistryWrapTxDto): Promise<TxPlan> {
    return this.builder.wrap(id, body);
  }

  @Post("baskets/:id/tx/registry/batch-wrap")
  @ApiOperation({ summary: "Build a registry batch-wrap plan (per-token approves + batchWrap)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryBatchWrap(@Param("id") id: string, @Body() body: RegistryBatchWrapTxDto): Promise<TxPlan> {
    return this.builder.batchWrap(id, body);
  }

  @Post("baskets/:id/tx/registry/unwrap")
  @ApiOperation({ summary: "Build a registry unwrap plan (burn own claim → send real ERC-20)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryUnwrap(@Param("id") id: string, @Body() body: RegistryUnwrapTxDto): Promise<TxPlan> {
    return this.builder.unwrap(id, body);
  }

  @Post("baskets/:id/tx/registry/set-operator")
  @ApiOperation({ summary: "Build a registry setOperator plan (ERC-6909 operator authorization over claims)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registrySetOperator(@Param("id") id: string, @Body() body: RegistrySetOperatorTxDto): Promise<TxPlan> {
    return this.builder.setOperator(id, body);
  }

  @Post("baskets/:id/tx/registry/bootstrap")
  @ApiOperation({ summary: "Build a registry bootstrap plan (approves + wraps + Merkle-gated genesis mint)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryBootstrap(@Param("id") id: string, @Body() body: RegistryBootstrapTxDto): Promise<TxPlan> {
    return this.builder.bootstrap(id, body);
  }

  @Post("baskets/:id/tx/registry/create")
  @ApiOperation({ summary: "Build a registry in-kind create plan (wrap claim shortfall + create N shares)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryCreate(@Param("id") id: string, @Body() body: RegistryCreateTxDto): Promise<TxPlan> {
    return this.builder.registryCreate(id, body);
  }

  @Post("baskets/:id/tx/registry/redeem")
  @ApiOperation({ summary: "Build a registry in-kind redeem plan (burn shares → claims, then unwrap to ERC-20)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  registryRedeem(@Param("id") id: string, @Body() body: RegistryRedeemTxDto): Promise<TxPlan> {
    return this.builder.registryRedeem(id, body);
  }

  @Post("tokens/:token/tx/faucet")
  @ApiOperation({ summary: "Build a demo faucet plan (faucetMint the mock Stock token to the caller)" })
  @ApiParam({ name: "token", description: "ERC-20 token address (a demo Stock)" })
  faucet(@Param("token") token: string, @Body() body: FaucetTxDto): Promise<TxPlan> {
    return this.builder.faucet(token, body);
  }

  @Post("baskets/:id/tx/forward/create")
  @ApiOperation({ summary: "Build a forward-cash create plan (approve cash + queue request) + availability gate" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  forwardCreate(@Param("id") id: string, @Body() body: ForwardCreateTxDto): Promise<TxPlan> {
    return this.builder.forwardCreate(id, body);
  }

  @Post("baskets/:id/tx/forward/redeem")
  @ApiOperation({ summary: "Build a forward-cash redeem plan (approve shares + queue request) + availability gate" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  forwardRedeem(@Param("id") id: string, @Body() body: ForwardRedeemTxDto): Promise<TxPlan> {
    return this.builder.forwardRedeem(id, body);
  }

  @Post("baskets/:id/tx/forward/cancel")
  @ApiOperation({ summary: "Build a forward-cash cancel plan for a queued ticket" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  forwardCancel(@Param("id") id: string, @Body() body: ForwardCancelTxDto): Promise<TxPlan> {
    return this.builder.forwardCancel(id, body);
  }

  @Post("baskets/:id/tx/curator/schedule")
  @ApiOperation({ summary: "Build a curator scheduleTarget plan (manager-gated)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  curatorSchedule(@Param("id") id: string, @Body() body: CuratorScheduleTxDto): Promise<TxPlan> {
    return this.builder.curatorSchedule(id, body);
  }

  @Post("baskets/:id/tx/curator/activate")
  @ApiOperation({ summary: "Build a curator activateTarget plan (manager-gated)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  curatorActivate(@Param("id") id: string, @Body() body: CuratorActivateTxDto): Promise<TxPlan> {
    return this.builder.curatorActivate(id, body);
  }

  @Post("baskets/:id/tx/keeper/record")
  @ApiOperation({ summary: "Build a keeper record plan (holdings-NAV observation)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  keeperRecord(@Param("id") id: string, @Body() body: KeeperRecordTxDto): Promise<TxPlan> {
    return this.builder.keeperRecord(id, body);
  }

  @Post("baskets/:id/tx/keeper/settle")
  @ApiOperation({ summary: "Build a keeper settle plan for queued forward tickets" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  keeperSettle(@Param("id") id: string, @Body() body: KeeperSettleTxDto): Promise<TxPlan> {
    return this.builder.keeperSettle(id, body);
  }

  @Post("baskets/:id/tx/auction/open")
  @ApiOperation({ summary: "Build a rebalance-auction open plan from operator-entered release/acquire legs" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  auctionOpen(@Param("id") id: string, @Body() body: AuctionOpenTxDto): Promise<TxPlan> {
    return this.builder.auctionOpen(id, body);
  }

  @Post("baskets/:id/tx/auction/bid")
  @ApiOperation({ summary: "Build a rebalance-auction bid plan (acquire tokens must be pre-approved)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  auctionBid(@Param("id") id: string, @Body() body: AuctionBidTxDto): Promise<TxPlan> {
    return this.builder.auctionBid(id, body);
  }

  @Post("baskets/:id/tx/auction/set-exec-mode")
  @ApiOperation({ summary: "Build a rebalance-auction setExecMode plan (manager-gated)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  auctionSetExecMode(@Param("id") id: string, @Body() body: AuctionSetExecModeTxDto): Promise<TxPlan> {
    return this.builder.auctionSetExecMode(id, body);
  }

  @Post("tx/deploy")
  @ApiOperation({ summary: "Build a CloneFactory deploy plan for a new vault" })
  deploy(@Body() body: DeployTxDto): Promise<TxPlan> {
    return this.builder.deploy(body);
  }

  @Post("tx/preview-deploy")
  @ApiOperation({ summary: "Derive unitQty + price a basket + return the simulate-create predicted vault" })
  previewDeploy(@Body() body: PreviewDeployDto): Promise<DeployPreview> {
    return this.preview.preview(body);
  }

  @Get("baskets/:id/auction")
  @ApiOperation({ summary: "Read RebalanceAuction state for a vault (execMode, openAllow, currentAcquireIn)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  auctionStatusGet(
    @Param("id") id: string,
    @Query("account") account?: string,
  ) {
    return this.auctionStatus.status(id, account ?? null);
  }
}
