import { Injectable, Logger } from "@nestjs/common";
import { parseUnits } from "viem";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { FairValueSinkPort } from "../capabilities/fair-value-sink.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { AttestationPushPayload, KeeperResult } from "./keeper.types.js";

/**
 * Pushes a stored, validated fair-value attestation on-chain through FairValueSinkPort
 * (live adapter = NAVEngine.setFairValueAttestation; null adapter at L1 → capability absent).
 *
 * Degrade-safe: KEEPER_ENABLED=false → noop; no walletClient → noop; sink capability absent → noop.
 * Idempotent: skips when pushedTxHash is already set on the stored attestation row.
 */
@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(
    private readonly chain: ChainService,
    private readonly sink: FairValueSinkPort,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async push(payload: AttestationPushPayload): Promise<KeeperResult> {
    if (!this.config.get("KEEPER_ENABLED")) {
      return { status: "noop", detail: "keeper disabled" };
    }

    if (!this.chain.walletClient) {
      this.logger.warn(
        "AttestationService: walletClient absent (KEEPER_PRIVATE_KEY not set) — skipping push",
      );
      return { status: "noop", detail: "no walletClient — KEEPER_PRIVATE_KEY not configured" };
    }

    const att = await this.prisma.fairValueAttestation.findUnique({
      where: { id: payload.attestationId },
    });
    if (!att) {
      return { status: "noop", detail: `attestation ${payload.attestationId} not found` };
    }
    if (att.pushedTxHash) {
      return {
        status: "skipped",
        txHash: att.pushedTxHash as `0x${string}`,
        detail: "already pushed",
      };
    }

    let txHash: `0x${string}`;
    try {
      txHash = await this.sink.push({
        vault: att.vaultAddress as `0x${string}`,
        nav: parseUnits(att.nav.toString(), 18),
        confidenceLower: parseUnits(att.lower.toString(), 18),
        confidenceUpper: parseUnits(att.upper.toString(), 18),
        timestamp: BigInt(Math.floor(att.timestamp.getTime() / 1000)),
        signature: att.signature as `0x${string}`,
      });
    } catch (err) {
      if (err instanceof CapabilityUnavailableError) {
        this.logger.warn(`AttestationService dormant: ${err.message}`);
        return { status: "noop", detail: err.message };
      }
      throw err;
    }

    await this.prisma.fairValueAttestation.update({
      where: { id: att.id },
      data: { pushedTxHash: txHash, pushedAt: new Date() },
    });
    this.logger.log(`fair-value attestation pushed tx ${txHash} for ${att.vaultAddress}`);
    return { status: "submitted", txHash };
  }
}
