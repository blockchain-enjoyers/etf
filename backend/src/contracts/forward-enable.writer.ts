import { Injectable } from "@nestjs/common";
import { maxUint256 } from "viem";
import {
  ForwardCashQueueAbi,
  ForwardCashQueueBytecode,
  KeeperModuleAbi,
  PriceAggregatorAbi,
  RegistryRebalanceVaultAbi,
  ManagedRebalanceVaultAbi,
} from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";

type Hash = `0x${string}`;
type Addr = `0x${string}`;

/**
 * Thin, idempotent on-chain write-helper for enabling forward-cash settlement.
 * Each method returns a tx hash so the orchestrating handler can collect txHashes;
 * `ensure*` methods read state first and skip (return undefined) when already satisfied.
 */
@Injectable()
export class ForwardEnableWriter {
  constructor(private readonly chain: ChainService) {}

  private signer(): { walletClient: NonNullable<ChainService["walletClient"]>; account: NonNullable<ChainService["account"]> } {
    if (!this.chain.walletClient || !this.chain.account) {
      throw new Error("writer requires a signer (KEEPER_PRIVATE_KEY)");
    }
    return { walletClient: this.chain.walletClient, account: this.chain.account };
  }

  private write(address: Addr, abi: unknown, functionName: string, args: readonly unknown[]): Promise<Hash> {
    const { walletClient, account } = this.signer();
    return walletClient.writeContract({
      address,
      abi: abi as never,
      functionName: functionName as never,
      args: args as never,
      account,
      chain: this.chain.chain,
    });
  }

  async deployQueue(args: {
    vault: Addr;
    stable: Addr;
    navEngine: Addr;
    observer: Addr;
    keeperModule: Addr;
    router: Addr;
    pegFeed: Addr;
    owner: Addr;
  }): Promise<Addr> {
    const { walletClient, account } = this.signer();
    const hash = await walletClient.deployContract({
      abi: ForwardCashQueueAbi as never,
      bytecode: ForwardCashQueueBytecode as never,
      args: [
        args.vault,
        args.stable,
        args.navEngine,
        args.observer,
        args.keeperModule,
        args.router,
        args.pegFeed,
        args.owner,
      ] as never,
      account,
      chain: this.chain.chain,
    });
    const receipt = await this.chain.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) {
      throw new Error("deployQueue: no contractAddress in receipt");
    }
    return receipt.contractAddress;
  }

  setGateParams(
    queue: Addr,
    p: { minN: bigint | number; win: bigint | number; twBps: bigint | number; pegBps: bigint | number; pegMaxAge: bigint | number },
  ): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setGateParams", [
      p.minN,
      p.win,
      p.twBps,
      p.pegBps,
      p.pegMaxAge,
    ]);
  }

  setG1Refs(queue: Addr, aggregator: Addr, l2RouterSource: Addr): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setG1Refs", [aggregator, l2RouterSource]);
  }

  setKeeperTip(queue: Addr, tip: bigint): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setKeeperTip", [tip]);
  }

  setSpreadBps(queue: Addr, b: number): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setSpreadBps", [b]);
  }

  setCapacity(queue: Addr, bps: number): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setCapacity", [bps]);
  }

  setCutoffDelay(queue: Addr, d: number): Promise<Hash> {
    return this.write(queue, ForwardCashQueueAbi, "setCutoffDelay", [d]);
  }

  async ensureExecutor(keeperModule: Addr, queue: Addr): Promise<Hash | undefined> {
    const hashes: Hash[] = [];

    const isExecutor = (await this.chain.publicClient.readContract({
      address: keeperModule,
      abi: KeeperModuleAbi,
      functionName: "isExecutor",
      args: [queue],
    })) as boolean;
    if (!isExecutor) {
      hashes.push(await this.write(keeperModule, KeeperModuleAbi, "setExecutor", [queue, true]));
    }

    const cap = (await this.chain.publicClient.readContract({
      address: keeperModule,
      abi: KeeperModuleAbi,
      functionName: "maxRewardPerCall",
    })) as bigint;
    if (cap === 0n) {
      hashes.push(await this.write(keeperModule, KeeperModuleAbi, "setMaxRewardPerCall", [maxUint256]));
    }

    return hashes.at(-1);
  }

  async ensureSettler(vault: Addr, queue: Addr): Promise<Hash | undefined> {
    const isSettler = (await this.chain.publicClient.readContract({
      address: vault,
      abi: RegistryRebalanceVaultAbi,
      functionName: "isSettler",
      args: [queue],
    })) as boolean;
    if (isSettler) return undefined;
    return this.write(vault, RegistryRebalanceVaultAbi, "setSettler", [queue, true]);
  }

  async ensureSources(aggregator: Addr, token: Addr, weekday: Addr, weekend: Addr): Promise<Hash | undefined> {
    const count = (await this.chain.publicClient.readContract({
      address: aggregator,
      abi: PriceAggregatorAbi,
      functionName: "sourceCount",
      args: [token],
    })) as bigint;
    if (count > 0n) return undefined;
    await this.write(aggregator, PriceAggregatorAbi, "addSource", [token, weekday]);
    return this.write(aggregator, PriceAggregatorAbi, "addSource", [token, weekend]);
  }

  setKeeperBps(vault: Addr, bps: number): Promise<Hash> {
    return this.write(vault, ManagedRebalanceVaultAbi, "setKeeperBps", [bps]);
  }
}
