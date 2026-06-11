import { Injectable, Logger } from "@nestjs/common";
import { getAddress, verifyTypedData } from "viem";
import { ConfigService } from "../config/config.service.js";
import { MarketStatus } from "../domain/market-status.js";
import { type NavResult, OracleSource } from "../domain/oracle.js";
import { PrismaService } from "../persistence/prisma.service.js";
import {
  FAIR_VALUE_EIP712_TYPES,
  fairValueDomain,
  type SignedFairValue,
} from "./fair-value.types.js";

@Injectable()
export class FairValueService {
  private readonly logger = new Logger(FairValueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Overridable for tests. */
  protected nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Trust boundary: verify EIP-712 signer == configured signer, freshness, and band sanity,
   * then persist. Throws on any failure (caller surfaces 4xx / job-fails).
   */
  async ingest(input: SignedFairValue): Promise<{ id: string }> {
    if (input.lower > input.nav || input.nav > input.upper) {
      throw new Error("fair value band invalid: require lower <= nav <= upper");
    }

    const maxAge = this.config.get("FAIRVALUE_MAX_AGE_SECONDS") as number;
    const age = this.nowSeconds() - input.timestamp;
    if (age > maxAge) {
      throw new Error(`fair value stale: age ${age}s exceeds max ${maxAge}s`);
    }
    if (input.timestamp - this.nowSeconds() > 60) {
      throw new Error("fair value timestamp is in the future");
    }

    const chainId = this.config.get("CHAIN_ID") as number;
    const verifyingContract = getAddress(
      this.config.get("FAIRVALUE_VERIFYING_CONTRACT") as string,
    );
    const expectedSigner = getAddress(
      this.config.get("FAIRVALUE_SIGNER_ADDRESS") as string,
    );

    const valid = await verifyTypedData({
      address: expectedSigner,
      domain: fairValueDomain(chainId, verifyingContract),
      types: FAIR_VALUE_EIP712_TYPES,
      primaryType: "FairValue",
      message: {
        basketId: input.basketId,
        nav: input.nav,
        lower: input.lower,
        upper: input.upper,
        timestamp: BigInt(input.timestamp),
      },
      signature: input.signature,
    });
    if (!valid) {
      throw new Error("fair value signer mismatch: signature does not recover to configured signer");
    }

    const row = await this.prisma.fairValueAttestation.create({
      data: {
        vaultAddress: input.basketId,
        nav: input.nav.toString(),
        lower: input.lower.toString(),
        upper: input.upper.toString(),
        timestamp: new Date(input.timestamp * 1000),
        signer: expectedSigner,
        signature: input.signature,
      },
    });
    this.logger.log(`ingested fair value ${row.id} for ${input.basketId}`);
    return { id: row.id };
  }

  /**
   * Closed-market path consumed by NavEngineService. Returns the latest stored attestation
   * as an ALWAYS-estimated NavResult (never a settlement price). Null if none stored.
   */
  async latestForBasket(basketId: string): Promise<NavResult | null> {
    const row = await this.prisma.fairValueAttestation.findFirst({
      where: { vaultAddress: basketId },
      orderBy: { timestamp: "desc" },
    });
    if (!row) return null;
    return {
      nav: BigInt(row.nav.toFixed(0)),
      confidenceLower: BigInt(row.lower.toFixed(0)),
      confidenceUpper: BigInt(row.upper.toFixed(0)),
      marketStatus: MarketStatus.Closed,
      source: OracleSource.LastClose,
      estimated: true,
      timestamp: Math.floor(row.timestamp.getTime() / 1000),
    };
  }
}
