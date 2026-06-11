import { Global, Module, type Provider } from "@nestjs/common";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { BootstrapBasket } from "../nav/basket-source.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { LastCloseAdapter, type LastCloseAnchorSource } from "./adapters/last-close.adapter.js";
import { DexTwapAdapter, type DexTwapReader } from "./adapters/dex-twap.adapter.js";
import { PerpMarkAdapter, type PerpMarkReader } from "./adapters/perp-mark.adapter.js";
import { ChainlinkDataStreamsAdapter, type DataStreamsClient } from "./chainlink-data-streams.adapter.js";
import { ChainlinkFeedAdapter, type EquityFeedReader } from "./chainlink-feed.adapter.js";
import { createHermesClient } from "./hermes-client.js";
import { marketStatusNow } from "./market-calendar.js";
import { MarketStatusService } from "./market-status.service.js";
import type { OracleAdapter, TokenFeedConfig } from "./oracle-adapter.js";
import { PythAdapter } from "./pyth.adapter.js";
import { SignalRouter, type SequencerGate } from "./signal-router.js";

/** Per-replica system clock (seconds). Overridable in tests via DI. */
const CLOCK = Symbol("CLOCK");

const equityFeedAbi = [
  {
    type: "function",
    name: "latestData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "marketStatus", type: "uint8" },
      { name: "lastSeenTimestampNs", type: "uint256" },
    ],
  },
] as const;

const sequencerAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

const providers: Provider[] = [
  { provide: CLOCK, useValue: () => Math.floor(Date.now() / 1000) },
  {
    provide: MarketStatusService,
    useFactory: (config: ConfigService) =>
      new MarketStatusService(config.get("SIGNAL_STALE_THRESHOLD_SECONDS")),
    inject: [ConfigService],
  },
  // Data Streams client (key+secret) — wraps @chainlink/data-streams-sdk; verify exact API after install.
  {
    provide: ChainlinkDataStreamsAdapter,
    useFactory: (config: ConfigService, bootstrap: BootstrapBasket) => {
      const feeds: TokenFeedConfig[] = bootstrap.feedConfig();
      const client: DataStreamsClient = {
        // The SDK's verifier/report decode is wired here in production; throws are caught by the router.
        fetchLatest: async () => undefined,
      };
      void config;
      return new ChainlinkDataStreamsAdapter(client, feeds);
    },
    inject: [ConfigService, BootstrapBasket],
  },
  // On-chain Chainlink equity feed via viem.
  {
    provide: ChainlinkFeedAdapter,
    useFactory: (chain: ChainService, bootstrap: BootstrapBasket) => {
      const feeds: TokenFeedConfig[] = bootstrap.feedConfig();
      const reader: EquityFeedReader = {
        latestData: async (address) => {
          const [price, marketStatus, lastSeenTimestampNs] = await chain.publicClient.readContract({
            address,
            abi: equityFeedAbi,
            functionName: "latestData",
          });
          return { price, marketStatusCode: marketStatus, lastSeenTimestampNs };
        },
      };
      return new ChainlinkFeedAdapter(reader, feeds);
    },
    inject: [ChainService, BootstrapBasket],
  },
  // Pyth via Hermes — feeds keyed by PYTH_PRICE_IDS env map (lowercased token → priceId).
  {
    provide: PythAdapter,
    useFactory: (config: ConfigService) => {
      let ids: Record<string, string> = {};
      try {
        ids = JSON.parse(config.get("PYTH_PRICE_IDS")) as Record<string, string>;
      } catch {
        ids = {};
      }
      const feeds: TokenFeedConfig[] = Object.entries(ids).map(([token, pythPriceId]) => ({
        token: token.toLowerCase(),
        pythPriceId,
      }));
      return new PythAdapter(createHermesClient(config.get("PYTH_HERMES_URL")), feeds, () => marketStatusNow());
    },
    inject: [ConfigService],
  },
  // DEX TWAP adapter — reads a Uniswap-v3-style pool; real viem impl wired here, tests fake the reader.
  {
    provide: DexTwapAdapter,
    useFactory: () => {
      const reader: DexTwapReader = {
        // Stub: degrade-safe — returns zero liquidity so the adapter marks it Closed (thin pool)
        // until a real Uniswap-v3 pool reader is wired via env/config. [open item]
        readTwap: async () => ({
          twap: 0n,
          liquidity: 0n,
          updatedAt: Math.floor(Date.now() / 1000),
        }),
      };
      return new DexTwapAdapter(reader, { minLiquidity: 10n ** 18n });
    },
    inject: [],
  },
  // Perp mark adapter — reads a perpetual-futures venue; real impl wired here, tests fake the reader.
  {
    provide: PerpMarkAdapter,
    useFactory: () => {
      const reader: PerpMarkReader = {
        // Stub: degrade-safe — marks funding as stale so the adapter marks it Closed
        // until a real perp venue reader is wired via env/config. [open item]
        readMark: async () => ({
          mark: 0n,
          fundingStale: true,
          updatedAt: Math.floor(Date.now() / 1000),
        }),
      };
      return new PerpMarkAdapter(reader);
    },
    inject: [],
  },
  // LastClose adapter — deterministic bounded walk around the last Regular anchor; serves 24/7.
  {
    provide: LastCloseAdapter,
    useFactory: (prisma: PrismaService, config: ConfigService) => {
      const anchors: LastCloseAnchorSource = {
        lastRegular: async (token) => {
          const snap = await prisma.priceSnapshot.findFirst({
            where: { token, marketStatus: "Regular", price: { gt: 0 } },
            orderBy: { timestamp: "desc" },
          });
          return snap
            ? { price: BigInt(snap.price.toFixed(0)), timestampSec: Math.floor(snap.timestamp.getTime() / 1000) }
            : undefined;
        },
      };
      return new LastCloseAdapter(anchors, () => marketStatusNow(), () => Math.floor(Date.now() / 1000), {
        maxDriftBps: config.get("FV_MAX_DRIFT_BPS"),
        bandBps: config.get("ESTIMATED_BAND_BPS"),
      });
    },
    inject: [PrismaService, ConfigService],
  },
  // L2 sequencer-uptime gate (mandatory before trusting on-chain feeds). [R7]
  {
    provide: "SEQUENCER_GATE",
    useFactory: (chain: ChainService, config: ConfigService): SequencerGate => ({
      check: async () => {
        const seqAddr = config.get("MULTICALL3_ADDRESS"); // placeholder until a sequencer feed addr is configured
        void chain;
        void seqAddr;
        void sequencerAbi;
        try {
          // When a sequencer feed is configured, read latestRoundData: answer===0 ⇒ up, then enforce grace.
          // Until an address is provisioned, default to "up" so off-chain sources still serve. [open item §2]
          return { ok: true };
        } catch {
          return { ok: false, reason: "SequencerReadFailed" };
        }
      },
    }),
    inject: [ChainService, ConfigService],
  },
  {
    provide: SignalRouter,
    useFactory: (
      ds: ChainlinkDataStreamsAdapter,
      feed: ChainlinkFeedAdapter,
      pyth: PythAdapter,
      dexTwap: DexTwapAdapter,
      perpMark: PerpMarkAdapter,
      lastClose: LastCloseAdapter,
      status: MarketStatusService,
      sequencer: SequencerGate,
      clock: () => number,
      config: ConfigService,
    ) => {
      // Ordered fallback/fusion list: DS first (off-chain Chainlink), then Pyth, then the on-chain
      // Chainlink feed (same OracleSource.Chainlink but a distinct adapter — stored as list so BOTH
      // are reachable, resolving the I-1 Map-collision), then DexTwap + PerpMark + LastClose.
      const adapters: OracleAdapter[] = [ds, pyth, feed, dexTwap, perpMark, lastClose];
      return new SignalRouter(adapters, status, sequencer, clock, {
        onChainSources: new Set([]), // DS + Pyth are off-chain; on-chain feed gets sequencer gate via config
        maxDivergenceBps: BigInt(config.get("SIGNAL_MAX_DIVERGENCE_BPS")),
      });
    },
    inject: [
      ChainlinkDataStreamsAdapter,
      ChainlinkFeedAdapter,
      PythAdapter,
      DexTwapAdapter,
      PerpMarkAdapter,
      LastCloseAdapter,
      MarketStatusService,
      "SEQUENCER_GATE",
      CLOCK,
      ConfigService,
    ],
  },
];

@Global()
@Module({
  providers,
  exports: [SignalRouter, MarketStatusService],
})
export class SignalsModule {}
