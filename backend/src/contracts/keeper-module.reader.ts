import { Injectable } from "@nestjs/common";
import { KeeperModuleAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "./capability-registry.js";

type EventOf<N extends string> = Extract<
  (typeof KeeperModuleAbi)[number],
  { type: "event"; name: N }
>;
function findEvent<N extends string>(name: N): EventOf<N> {
  return KeeperModuleAbi.find((e): e is EventOf<N> => e.type === "event" && e.name === name)!;
}

@Injectable()
export class KeeperModuleReader {
  readonly abi = KeeperModuleAbi;
  readonly rewardPaidEvent = findEvent("RewardPaid");

  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
  ) {}

  get address(): `0x${string}` | undefined {
    return this.registry.address("KeeperModule");
  }

  async escrowOf(vaultShare: `0x${string}`): Promise<bigint> {
    const addr = this.address;
    if (!addr) return 0n;
    return this.chain.publicClient.readContract({
      address: addr,
      abi: KeeperModuleAbi,
      functionName: "escrowOf",
      args: [vaultShare],
    }) as Promise<bigint>;
  }
}
