import { Injectable } from "@nestjs/common";
import { ManagedRebalanceVaultAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";

type EventOf<N extends string> = Extract<
  (typeof ManagedRebalanceVaultAbi)[number],
  { type: "event"; name: N }
>;
function findEvent<N extends string>(name: N): EventOf<N> {
  return ManagedRebalanceVaultAbi.find(
    (e): e is EventOf<N> => e.type === "event" && e.name === name,
  )!;
}

@Injectable()
export class ManagedRebalanceVaultReader {
  readonly abi = ManagedRebalanceVaultAbi;
  readonly targetScheduledEvent = findEvent("TargetScheduled");
  readonly targetActivatedEvent = findEvent("TargetActivated");
  readonly rebalancedEvent = findEvent("Rebalanced");

  constructor(private readonly chain: ChainService) {}

  async heldTokens(vault: `0x${string}`): Promise<`0x${string}`[]> {
    const result = await this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "heldTokens",
    });
    return [...result];
  }

  async totalSupply(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "totalSupply",
    }) as Promise<bigint>;
  }

  async keeperBps(vault: `0x${string}`): Promise<number> {
    const result = await this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "keeperBps",
    });
    return Number(result);
  }

  async keeperEscrow(vault: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "keeperEscrow",
    });
  }

  async managerFeeBps(vault: `0x${string}`): Promise<number> {
    const result = await this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "managerFeeBps",
    });
    return Number(result);
  }

  async targetEffectiveAt(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "targetEffectiveAt",
    });
  }

  async holdingsOf(vault: `0x${string}`, token: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "holdingsOf",
      args: [token],
    }) as Promise<bigint>;
  }

  /** Fixed USDG fee FeeCore.create() pulls at settle on a registry vault (0 on the no-op fee seam). */
  async flatCreateFee(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "flatCreateFee",
    }) as Promise<bigint>;
  }

  /** Fixed USDG fee deducted from redeem proceeds at settle on a registry vault. */
  async flatRedeemFee(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "flatRedeemFee",
    }) as Promise<bigint>;
  }

  /** The USDG fee token the flat create/redeem fees are denominated in. */
  async feeToken(vault: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "feeToken",
    });
  }

  /** The vault manager (FeeCore.manager) authorized to enable cash settlement. */
  async manager(vault: `0x${string}`): Promise<`0x${string}`> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: ManagedRebalanceVaultAbi,
      functionName: "manager",
    });
  }
}
