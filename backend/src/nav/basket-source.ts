import { Injectable } from "@nestjs/common";
import type { TokenFeedConfig } from "../signals/oracle-adapter.js";

/** One constituent of a basket: how much is held (18-dec) and how to price it. */
export interface BasketHolding {
  token: string;
  /** Holding amount in 18-dec (mirrors BasketVault.holdingOf normalized). */
  amount: bigint;
  decimals: number;
}

export interface BasketDefinition {
  basketId: string;
  name: string;
  symbol: string;
  holdings: BasketHolding[];
}

/**
 * Supplies the basket definition + per-token feed wiring for the off-chain NAV path.
 * Day-one this is a configured "bootstrap" basket (spec open item §4) so the API has data before our
 * BasketVault is deployed. Once addresses are present, NavEngineService reads holdings on-chain instead.
 */
@Injectable()
export class BootstrapBasket {
  /** A single demo basket: equal 18-dec holdings of two tokenized stocks. Replace via config in prod. */
  private readonly basket: BasketDefinition = {
    basketId: "0x0000000000000000000000000000000000000000000000000000000000000001",
    name: "Meridian Bootstrap Basket",
    symbol: "mBOOT",
    holdings: [
      { token: "0x00000000000000000000000000000000000000a1", amount: 10_000_000_000_000_000_000n, decimals: 18 },
      { token: "0x00000000000000000000000000000000000000a2", amount: 5_000_000_000_000_000_000n, decimals: 18 },
    ],
  };

  private readonly feeds: TokenFeedConfig[] = [
    {
      token: "0x00000000000000000000000000000000000000a1",
      dataStreamsFeedId: "0x0001",
      chainlinkFeedAddress: "0x00000000000000000000000000000000000000b1",
      chainlinkFeedDecimals: 8,
      pythPriceId: "0xpyth-a1",
    },
    {
      token: "0x00000000000000000000000000000000000000a2",
      dataStreamsFeedId: "0x0002",
      chainlinkFeedAddress: "0x00000000000000000000000000000000000000b2",
      chainlinkFeedDecimals: 8,
      pythPriceId: "0xpyth-a2",
    },
  ];

  definition(basketId?: string): BasketDefinition | undefined {
    if (!basketId || basketId === this.basket.basketId) return this.basket;
    return undefined;
  }

  feedConfig(): TokenFeedConfig[] {
    return this.feeds;
  }
}
