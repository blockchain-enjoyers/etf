import { Injectable } from "@nestjs/common";
import { RebalanceAuctionAbi } from "@meridian/contracts";
import type { AuctionStatus } from "@meridian/sdk";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";

@Injectable()
export class AuctionStatusService {
  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
  ) {}

  async status(vault: string, account: string | null): Promise<AuctionStatus> {
    const auctionAddr = this.registry.address("RebalanceAuction");
    if (!auctionAddr) {
      return { vaultAddress: vault, deployed: false, execMode: 0, openAllow: false, acquireIn: [] };
    }

    const vaultAddr = vault as `0x${string}`;

    const [execModeRaw, acquireInRaw] = await Promise.all([
      this.chain.publicClient
        .readContract({
          address: auctionAddr,
          abi: RebalanceAuctionAbi,
          functionName: "execMode",
          args: [vaultAddr],
        })
        .catch(() => 0 as number),
      this.chain.publicClient
        .readContract({
          address: auctionAddr,
          abi: RebalanceAuctionAbi,
          functionName: "currentAcquireIn",
          args: [vaultAddr],
        })
        .catch(() => [] as readonly bigint[]),
    ]);

    let openAllow = false;
    if (account) {
      openAllow = await this.chain.publicClient
        .readContract({
          address: auctionAddr,
          abi: RebalanceAuctionAbi,
          functionName: "openAllow",
          args: [vaultAddr, account as `0x${string}`],
        })
        .catch(() => false);
    }

    return {
      vaultAddress: vault,
      deployed: true,
      execMode: Number(execModeRaw),
      openAllow,
      acquireIn: (acquireInRaw as readonly bigint[]).map((v) => v.toString()),
    };
  }
}
