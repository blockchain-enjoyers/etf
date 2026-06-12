import { Injectable } from "@nestjs/common";
import { CloneFactoryAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "./capability-registry.js";

type EventOf<N extends string> = Extract<
  (typeof CloneFactoryAbi)[number],
  { type: "event"; name: N }
>;

function findEvent<N extends string>(name: N): EventOf<N> {
  return CloneFactoryAbi.find((e): e is EventOf<N> => e.type === "event" && e.name === name)!;
}

@Injectable()
export class CloneFactoryReader {
  readonly abi = CloneFactoryAbi;
  readonly basketCreatedEvent = findEvent("BasketCreated");
  readonly managedBasketCreatedEvent = findEvent("ManagedBasketCreated");
  readonly committedBasketCreatedEvent = findEvent("CommittedBasketCreated");
  readonly rebalanceBasketCreatedEvent = findEvent("RebalanceBasketCreated");
  readonly registryIndexCreatedEvent = findEvent("RegistryIndexCreated");

  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
  ) {}

  get address(): `0x${string}` | undefined {
    return this.registry.address("CloneFactory");
  }

  private requireAddress(): `0x${string}` {
    const addr = this.address;
    if (!addr) throw new Error("CloneFactory address not configured for the active chain");
    return addr;
  }

  async vaultCount(): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: this.requireAddress(),
      abi: CloneFactoryAbi,
      functionName: "vaultCount",
    });
  }

  async getVaults(start: bigint, limit: bigint): Promise<readonly `0x${string}`[]> {
    return this.chain.publicClient.readContract({
      address: this.requireAddress(),
      abi: CloneFactoryAbi,
      functionName: "getVaults",
      args: [start, limit],
    });
  }

  async predictBasketAddress(
    issuer: `0x${string}`,
    tokens: readonly `0x${string}`[],
    unitQty: readonly bigint[],
    unitSize: bigint,
    name: string,
    symbol: string,
    userSalt: `0x${string}`,
  ): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: this.requireAddress(),
      abi: CloneFactoryAbi,
      functionName: "predictBasketAddress",
      args: [issuer, tokens, unitQty, unitSize, name, symbol, userSalt],
    });
  }
}
