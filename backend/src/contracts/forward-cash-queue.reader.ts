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

  async maxCreateFlowBps(queue: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "maxCreateFlowBps",
    }) as Promise<bigint>;
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
