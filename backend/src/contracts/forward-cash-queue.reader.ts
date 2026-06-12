import { Injectable } from "@nestjs/common";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";

type EventOf<N extends string> = Extract<
  (typeof ForwardCashQueueAbi)[number],
  { type: "event"; name: N }
>;
function findEvent<N extends string>(name: N): EventOf<N> {
  return ForwardCashQueueAbi.find(
    (e): e is EventOf<N> => e.type === "event" && e.name === name,
  )!;
}

@Injectable()
export class ForwardCashQueueReader {
  readonly abi = ForwardCashQueueAbi;
  readonly createRequestedEvent = findEvent("CreateRequested");
  readonly redeemRequestedEvent = findEvent("RedeemRequested");
  readonly cancelledEvent = findEvent("Cancelled");
  readonly settledEvent = findEvent("Settled");
  readonly partialFillEvent = findEvent("PartialFill");

  constructor(private readonly chain: ChainService) {}

  async ticketCount(queue: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "ticketCount",
    }) as Promise<bigint>;
  }

  async vault(queue: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "vault",
    });
  }

  /** The BasketNavObserver this queue settles against. Each forward vault has its own queue+observer
   *  pair, so the observer must be read off the vault's queue — never resolved as a chain singleton. */
  async observer(queue: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "observer",
    });
  }

  async maxCreateFlowBps(queue: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "maxCreateFlowBps",
    }) as Promise<bigint>;
  }

  /** True when this queue settles against a registry vault (fixed flat USDG create/redeem fees). */
  async isRegistry(queue: `0x${string}`): Promise<boolean> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "isRegistry",
    }) as Promise<boolean>;
  }

  /** The settlement cash token. For a registry queue the constructor enforces stable == vault.feeToken. */
  async stable(queue: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "stable",
    });
  }

  async spreadBps(queue: `0x${string}`): Promise<number> {
    const r = await this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "spreadBps",
    });
    return Number(r);
  }

  async cutoffDelay(queue: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "cutoffDelay",
    }) as Promise<bigint>;
  }
}
