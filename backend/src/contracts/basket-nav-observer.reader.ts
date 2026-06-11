import { Injectable } from "@nestjs/common";
import { BasketNavObserverAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "./capability-registry.js";

@Injectable()
export class BasketNavObserverReader {
  readonly abi = BasketNavObserverAbi;

  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
  ) {}

  get address(): `0x${string}` | undefined {
    return this.registry.address("BasketNavObserver");
  }

  /** TWAP + observation count over [now-window, now]. Reverts NoObservations on a sparse window. */
  async consult(
    vault: `0x${string}`,
    window: bigint,
  ): Promise<{ twap: bigint; count: bigint }> {
    const addr = this.address;
    if (!addr) return { twap: 0n, count: 0n };
    const [twap, count] = (await this.chain.publicClient.readContract({
      address: addr,
      abi: BasketNavObserverAbi,
      functionName: "consult",
      args: [vault, window],
    })) as readonly [bigint, bigint];
    return { twap, count };
  }
}
