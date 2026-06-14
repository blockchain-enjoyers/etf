import { Injectable, Logger } from "@nestjs/common";
import { erc20Abi, maxUint256 } from "viem";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "./forward-settle-writer.port.js";

const ZERO_HASH = `0x${"0".repeat(64)}` as `0x${string}`;
// Managed path: re-approve below this; an existing max-approval (or near it) is left alone (idempotent).
const APPROVE_THRESHOLD = 2n ** 200n;

/** ERC-6909 + registry-holdings reads, isolated to avoid the vault's ERC-20/ERC-6909 `balanceOf` overload clash. */
const REGISTRY_ABI = [
  {
    type: "function",
    name: "isOperator",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "holdingsOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** MockAPFiller writes the keeper drives as the AP (the filler is `ap`, the keeper is msg.sender). */
const FILLER_ABI = [
  {
    type: "function",
    name: "approveConstituent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "queue", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setVaultOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "wrapInventory",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

/** ERC-6909 id for a constituent: id = uint160(token) == the address as an integer. */
const idOf = (token: `0x${string}`): bigint => BigInt(token);

@Injectable()
export class LiveForwardSettleWriter extends ForwardSettleWriterPort {
  private readonly logger = new Logger(LiveForwardSettleWriter.name);

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

  // Prepare the AP filler so the create-leg of settle can source the basket from it, for ANY vault (incl.
  // judge-created) on first settle — no manual per-vault script. The path differs by vault family:
  //   • MANAGED: the queue pulls real ERC-20 → ensure the filler approved the queue (ERC-20 allowance).
  //   • REGISTRY: the vault pulls the filler's ERC-6909 CLAIM slice → ensure the queue is the filler's
  //     ERC-6909 operator AND the filler holds enough claims (wrap real ERC-20, per-vault ledger).
  // Funding the filler's real ERC-20 inventory stays an out-of-band deployer concern (prepare-ap-filler.ts).
  async approve(vault: `0x${string}`, ap: `0x${string}`): Promise<`0x${string}`> {
    const queue = this.forwardQueues.queueFor(vault) as `0x${string}` | undefined;
    if (!queue || !this.chain.walletClient) throw new CapabilityUnavailableError("ForwardCashQueue");
    const held = await this.rebVault.heldTokens(vault);
    const isRegistry = (await this.chain.publicClient.readContract({
      address: queue,
      abi: ForwardCashQueueAbi,
      functionName: "isRegistry",
    })) as boolean;
    return isRegistry
      ? this.approveRegistry(vault, queue, ap, held)
      : this.approveManaged(queue, ap, held);
  }

  /** MANAGED: max-approve each under-allowanced constituent so the queue can transferFrom the AP. */
  private async approveManaged(
    queue: `0x${string}`,
    ap: `0x${string}`,
    held: `0x${string}`[],
  ): Promise<`0x${string}`> {
    let last: `0x${string}` | undefined;
    for (const token of held) {
      const allowance = (await this.chain.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [ap, queue],
      })) as bigint;
      if (allowance >= APPROVE_THRESHOLD) continue;
      last = await this.write(ap, "approveConstituent", [token, queue, maxUint256]);
    }
    return last ?? ZERO_HASH;
  }

  /** REGISTRY: authorize the queue as the filler's ERC-6909 operator + top the filler's claim inventory up. */
  private async approveRegistry(
    vault: `0x${string}`,
    queue: `0x${string}`,
    ap: `0x${string}`,
    held: `0x${string}`[],
  ): Promise<`0x${string}`> {
    let last: `0x${string}` | undefined;

    const isOperator = (await this.chain.publicClient.readContract({
      address: vault,
      abi: REGISTRY_ABI,
      functionName: "isOperator",
      args: [ap, queue],
    })) as boolean;
    if (!isOperator) last = await this.write(ap, "setVaultOperator", [vault, queue]);

    // Per held token, top claims up to the vault's own holding (1× current supply of create headroom — the
    // settleCreate need is ceil(holdings·N/supply), so holdings covers a create up to a full doubling), bounded
    // by the filler's real ERC-20 balance. Skip when already provisioned (idempotent; claims drop on each create).
    const tokens: `0x${string}`[] = [];
    const amounts: bigint[] = [];
    for (const token of held) {
      const [claims, target, real] = (await Promise.all([
        this.chain.publicClient.readContract({
          address: vault,
          abi: REGISTRY_ABI,
          functionName: "balanceOf",
          args: [ap, idOf(token)],
        }),
        this.chain.publicClient.readContract({
          address: vault,
          abi: REGISTRY_ABI,
          functionName: "holdingsOf",
          args: [token],
        }),
        this.chain.publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [ap],
        }),
      ])) as [bigint, bigint, bigint];
      if (claims >= target) continue;
      const shortfall = target - claims;
      const amount = shortfall < real ? shortfall : real;
      if (amount > 0n) {
        tokens.push(token);
        amounts.push(amount);
      } else {
        this.logger.warn(`AP ${ap} has no ${token} to wrap for ${vault} — fund the filler (prepare-ap-filler)`);
      }
    }
    if (tokens.length > 0) last = await this.write(ap, "wrapInventory", [vault, tokens, amounts]);

    return last ?? ZERO_HASH;
  }

  /** Submit a MockAPFiller write from the keeper and wait for the receipt (sequenced before settle). */
  private async write(ap: `0x${string}`, functionName: string, args: readonly unknown[]): Promise<`0x${string}`> {
    const hash = await this.chain.walletClient!.writeContract({
      chain: this.chain.chain,
      account: this.chain.account!,
      address: ap,
      abi: FILLER_ABI,
      functionName,
      args,
    } as never);
    await this.chain.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}
