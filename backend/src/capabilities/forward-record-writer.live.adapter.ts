import { Injectable } from "@nestjs/common";
import { BasketNavObserverAbi } from "@meridian/contracts";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ForwardCashQueueReader } from "../contracts/forward-cash-queue.reader.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardRecordWriterPort } from "./forward-record-writer.port.js";

@Injectable()
export class LiveForwardRecordWriter extends ForwardRecordWriterPort {
  constructor(
    private readonly chain: ChainService,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly queueReader: ForwardCashQueueReader,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly signer: PayloadSignerService,
  ) {
    super();
  }

  async record(vault: `0x${string}`): Promise<`0x${string}`> {
    // Per-vault observer: read it off this vault's queue, never a chain singleton — recording into the
    // wrong observer would poison another vault's TWAP window.
    const queue = this.forwardQueues.queueFor(vault);
    if (!queue || !this.chain.walletClient) {
      throw new CapabilityUnavailableError("BasketNavObserver");
    }
    const observer = await this.queueReader.observer(queue as `0x${string}`);
    const held = await this.rebVault.heldTokens(vault);
    const payloads = await Promise.all(held.map((t) => this.signer.payloadsFor(t)));
    return this.chain.walletClient.writeContract({
      chain: this.chain.chain,
      account: this.chain.account!,
      address: observer,
      abi: BasketNavObserverAbi,
      functionName: "record",
      args: [vault, held, payloads],
    } as never);
  }
}
