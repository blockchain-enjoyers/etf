import { Injectable, Logger } from "@nestjs/common";
import { BasketNavObserverAbi, RebalanceObserverAbi } from "@meridian/contracts";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "../chain/chain.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ConfigService } from "../config/config.service.js";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";

/**
 * 5-min TWAP-record cron: on-chain observers only accumulate when someone calls record(...).
 * Part 1 feeds RebalanceObserver (L3 band checks) per constituent; part 2 feeds
 * BasketNavObserver (L5 g6/g7) per rebalance vault. Payloads are signed fresh per tick.
 */
@Injectable()
export class TwapRecordHandler {
  private readonly logger = new Logger(TwapRecordHandler.name);
  private warnedNoWallet = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly registry: CapabilityRegistry,
    private readonly config: ConfigService,
    private readonly signer: PayloadSignerService,
    private readonly rebVault: ManagedRebalanceVaultReader,
  ) {}

  async run(): Promise<void> {
    if (!this.config.get("ORACLE_PUSH_ENABLED")) return;
    if (!this.chain.walletClient || !this.chain.account) {
      if (!this.warnedNoWallet) {
        this.warnedNoWallet = true;
        this.logger.warn("twap-record: keeper wallet not configured — skipping ticks");
      }
      return;
    }
    await this.recordConstituents();
    await this.recordBasketNav();
  }

  private async recordConstituents(): Promise<void> {
    const observer = this.registry.address("RebalanceObserver");
    if (!observer) {
      this.logger.warn("twap-record: RebalanceObserver address missing — skipping constituent records");
      return;
    }
    const tokens = await this.prisma.constituent.findMany({
      distinct: ["token"],
      select: { token: true },
    });
    for (const { token } of tokens) {
      try {
        const payloads = await this.signer.payloadsFor(token);
        const hash = await this.chain.walletClient!.writeContract({
          chain: this.chain.chain,
          account: this.chain.account!,
          address: observer,
          abi: RebalanceObserverAbi,
          functionName: "record",
          args: [token as `0x${string}`, payloads],
        } as never);
        await this.chain.publicClient.waitForTransactionReceipt({ hash });
      } catch (e) {
        this.logger.warn(`twap-record constituent ${token} failed: ${(e as Error).message}`);
      }
    }
  }

  private async recordBasketNav(): Promise<void> {
    // BasketNavObserver appears only after the L5 deploy — absent address is normal, skip silently.
    const observer = this.registry.address("BasketNavObserver");
    if (!observer) return;
    const baskets = await this.prisma.basket.findMany({
      where: { vaultType: "Rebalance" },
      select: { vaultAddress: true },
    });
    for (const { vaultAddress } of baskets) {
      try {
        const vault = vaultAddress as `0x${string}`;
        const held = await this.rebVault.heldTokens(vault);
        const payloads = await Promise.all(held.map((t) => this.signer.payloadsFor(t)));
        const hash = await this.chain.walletClient!.writeContract({
          chain: this.chain.chain,
          account: this.chain.account!,
          address: observer,
          abi: BasketNavObserverAbi,
          functionName: "record",
          args: [vault, held, payloads],
        } as never);
        await this.chain.publicClient.waitForTransactionReceipt({ hash });
      } catch (e) {
        this.logger.warn(`twap-record vault ${vaultAddress} failed: ${(e as Error).message}`);
      }
    }
  }
}
