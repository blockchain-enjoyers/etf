import { Injectable } from "@nestjs/common";
import { RebalanceModuleAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "./capability-registry.js";

@Injectable()
export class RebalanceModuleReader {
  readonly abi = RebalanceModuleAbi;

  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
  ) {}

  get address(): `0x${string}` | undefined {
    return this.registry.address("RebalanceModule");
  }

  async triggerBandBps(): Promise<number> {
    const addr = this.address;
    if (!addr) return 0;
    const result = await this.chain.publicClient.readContract({
      address: addr,
      abi: RebalanceModuleAbi,
      functionName: "triggerBandBps",
    });
    return Number(result);
  }
}
