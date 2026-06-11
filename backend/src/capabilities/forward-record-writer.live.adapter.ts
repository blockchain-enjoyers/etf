import { Injectable } from "@nestjs/common";
import { BasketNavObserverAbi } from "@meridian/contracts";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardRecordWriterPort } from "./forward-record-writer.port.js";

@Injectable()
export class LiveForwardRecordWriter extends ForwardRecordWriterPort {
  constructor(
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly signer: PayloadSignerService,
  ) {
    super();
  }

  async record(vault: `0x${string}`): Promise<`0x${string}`> {
    const observer = this.registry.address("BasketNavObserver");
    if (!observer || !this.chain.walletClient) {
      throw new CapabilityUnavailableError("BasketNavObserver");
    }
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
