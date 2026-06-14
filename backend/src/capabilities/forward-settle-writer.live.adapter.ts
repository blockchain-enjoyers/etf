import { Injectable } from "@nestjs/common";
import { erc20Abi, maxUint256 } from "viem";
import { ForwardCashQueueAbi, MockAPFillerAbi } from "@meridian/contracts";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "./forward-settle-writer.port.js";

const ZERO_HASH = `0x${"0".repeat(64)}` as `0x${string}`;
// Re-approve below this; an existing max-approval (or anything near it) is left alone so the loop is idempotent.
const APPROVE_THRESHOLD = 2n ** 200n;

@Injectable()
export class LiveForwardSettleWriter extends ForwardSettleWriterPort {
  constructor(
    private readonly chain: ChainService,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly rebVault: ManagedRebalanceVaultReader,
    private readonly signer: PayloadSignerService,
  ) {
    super();
  }

  async settle(vault: `0x${string}`, ids: bigint[], ap: `0x${string}`): Promise<`0x${string}`> {
    // Per-vault queue — each forward vault owns its ForwardCashQueue; the singleton would settle the wrong one.
    const queue = this.forwardQueues.queueFor(vault);
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

  // The queue PULLS each constituent from the AP filler at create settle, so the filler must have approved
  // the queue. Per held token: re-approve to max only when the current allowance has fallen below threshold,
  // so any vault (including judge-created ones) self-approves on its first settle without a manual script.
  // Funding the filler's inventory stays an out-of-band deployer concern (prepare-ap-filler.ts).
  async approve(vault: `0x${string}`, ap: `0x${string}`): Promise<`0x${string}`> {
    const queue = this.forwardQueues.queueFor(vault) as `0x${string}` | undefined;
    if (!queue || !this.chain.walletClient) throw new CapabilityUnavailableError("ForwardCashQueue");
    const held = await this.rebVault.heldTokens(vault);
    let last: `0x${string}` | undefined;
    for (const token of held) {
      const allowance = (await this.chain.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [ap, queue],
      })) as bigint;
      if (allowance >= APPROVE_THRESHOLD) continue;
      const hash = await this.chain.walletClient.writeContract({
        chain: this.chain.chain,
        account: this.chain.account!,
        address: ap,
        abi: MockAPFillerAbi,
        functionName: "approveConstituent",
        args: [token, queue, maxUint256],
      } as never);
      await this.chain.publicClient.waitForTransactionReceipt({ hash });
      last = hash;
    }
    return last ?? ZERO_HASH;
  }
}
