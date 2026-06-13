import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { PriceAggregatorAbi } from "@meridian/contracts";
import type { ConstituentPrice } from "@meridian/sdk";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { AggSourcePayloads } from "./agg-source-payloads.js";

/** Read-only seed for the FE price-safety sim: live median price + on-chain source count per held constituent. */
const MAX_CONSTITUENTS = 12;

@ApiTags("baskets")
@Controller("baskets")
export class ConstituentPricesController {
  constructor(
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly registry: CapabilityRegistry,
    private readonly chain: ChainService,
    private readonly aggSourcePayloads: AggSourcePayloads,
  ) {}

  @Get(":id/constituent-prices")
  @ApiOperation({ summary: "Live aggregated median price + source count per held constituent (first 12)" })
  @ApiParam({ name: "id", description: "Vault address" })
  async getConstituentPrices(@Param("id") id: string): Promise<ConstituentPrice[]> {
    const vault = id as `0x${string}`;
    const agg = this.registry.address("PriceAggregator");
    if (!agg) return [];

    const held = (await this.rebVault.heldTokens(vault)).slice(0, MAX_CONSTITUENTS);
    if (held.length === 0) return [];

    const payloads = await this.aggSourcePayloads.payloadsFor(held);

    return Promise.all(
      held.map(async (token, i) => {
        const count = (await this.chain.publicClient.readContract({
          address: agg,
          abi: PriceAggregatorAbi,
          functionName: "sourceCount",
          args: [token],
        })) as bigint;

        let price = "0";
        try {
          const { result } = await this.chain.publicClient.simulateContract({
            address: agg,
            abi: PriceAggregatorAbi,
            functionName: "priceOf",
            args: [token, payloads[i] as `0x${string}`[]],
            account: this.chain.account ?? "0x0000000000000000000000000000000000000001",
          });
          price = result.price.toString();
        } catch {
          // priceOf reverted (no fresh source / divergence) — still surface the row with sourceCount.
        }

        return { token, price, sourceCount: Number(count) };
      }),
    );
  }
}
