import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { addresses } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";

export type Capability =
  | "CloneFactory"
  | "BasketVault"
  | "ManagedVault"
  | "CommittedVault"
  | "FairValueNAV"
  | "PriceAggregator"
  | "ChainlinkStreamsSource"
  | "UniversalSignedSource"
  | "UniversalSignedSourceWeekend"
  | "ManagedRebalanceVault"
  | "RegistryRebalanceVault"
  | "RegistryCustody"
  | "KeeperModule"
  | "RebalanceAuction"
  | "RebalanceObserver"
  | "RebalanceModule"
  | "BasketNavObserver"
  | "ForwardCashQueue"
  | "MockAPFiller";

export type CapabilityStatus = "live" | "absent";

const ALL_CAPABILITIES: readonly Capability[] = [
  "CloneFactory",
  "BasketVault",
  "ManagedVault",
  "CommittedVault",
  "FairValueNAV",
  "PriceAggregator",
  "ChainlinkStreamsSource",
  "UniversalSignedSource",
  "UniversalSignedSourceWeekend",
  "ManagedRebalanceVault",
  "RegistryRebalanceVault",
  "RegistryCustody",
  "KeeperModule",
  "RebalanceAuction",
  "RebalanceObserver",
  "RebalanceModule",
  "BasketNavObserver",
  "ForwardCashQueue",
  "MockAPFiller",
];

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Single source of truth for "what is deployed on the active chain". Addresses come from
 * `@meridian/contracts` addresses[CHAIN_ID]; a capability is `present` when its address is set,
 * non-zero, and (after the boot probe) backed by on-chain bytecode. A configured-but-codeless
 * address is demoted to absent at boot — logged as an alarm, never fatal. [spec §2]
 */
@Injectable()
export class CapabilityRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(CapabilityRegistry.name);
  private readonly probedAbsent = new Set<Capability>();

  constructor(
    private readonly chainId: number,
    private readonly map: Record<string, `0x${string}`>,
    private readonly chain: ChainService,
  ) {}

  static create(config: ConfigService, chain: ChainService): CapabilityRegistry {
    const chainId = config.get("CHAIN_ID");
    const map = (addresses as Record<number, Record<string, `0x${string}`>>)[chainId] ?? {};
    return new CapabilityRegistry(chainId, map, chain);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.probe();
  }

  address(capability: Capability): `0x${string}` | undefined {
    const addr = this.map[capability];
    if (!addr || addr.toLowerCase() === ZERO) return undefined;
    return addr;
  }

  present(capability: Capability): boolean {
    if (this.probedAbsent.has(capability)) return false;
    return this.address(capability) !== undefined;
  }

  status(capability: Capability): CapabilityStatus {
    return this.present(capability) ? "live" : "absent";
  }

  /**
   * Boot probe: for each capability with a configured non-zero address, confirm the address
   * carries bytecode. A missing/`0x` result demotes the capability to absent (alarm-logged).
   */
  async probe(): Promise<void> {
    for (const capability of ALL_CAPABILITIES) {
      const addr = this.address(capability);
      if (!addr) continue;

      let code: `0x${string}` | undefined;
      try {
        code = await this.chain.publicClient.getCode({ address: addr });
      } catch (err) {
        this.logger.warn(
          `ALARM: probe for ${capability} at ${addr} (chain ${this.chainId}) threw; marking absent: ${String(err)}`,
        );
        this.probedAbsent.add(capability);
        continue;
      }

      if (!code || code === "0x") {
        this.logger.warn(
          `ALARM: ${capability} address ${addr} (chain ${this.chainId}) has no bytecode; marking absent`,
        );
        this.probedAbsent.add(capability);
      }
    }
  }
}
