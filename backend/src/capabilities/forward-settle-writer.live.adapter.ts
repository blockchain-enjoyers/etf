import { Injectable } from "@nestjs/common";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "./forward-settle-writer.port.js";

@Injectable()
export class LiveForwardSettleWriter extends ForwardSettleWriterPort {
  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly signer: PayloadSignerService,
  ) {
    super();
  }

  async settle(vault: `0x${string}`, ids: bigint[], ap: `0x${string}`): Promise<`0x${string}`> {
    const queue = this.registry.address("ForwardCashQueue");
    if (!queue || !this.chain.walletClient) throw new CapabilityUnavailableError("ForwardCashQueue");
    const held = await this.rebVault.heldTokens(vault);
    const payloads = await Promise.all(held.map((t) => this.signer.payloadsFor(t)));
    return this.chain.walletClient.writeContract({
      chain: this.chain.chain,
      account: this.chain.account!,
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "settle",
      args: [ids, held, payloads, ap],
    } as never);
  }

  // Testnet AP approvals are pre-seeded out-of-band (MockAPFiller.approveConstituent in deploy/fund
  // scripts). A live on-chain approve loop ships with production sourcing (flagged out of scope).
  async approve(_vault: `0x${string}`, _ap: `0x${string}`): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("ForwardCashQueue");
  }
}
