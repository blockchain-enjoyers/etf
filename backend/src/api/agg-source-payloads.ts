import { Injectable } from "@nestjs/common";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { SceneOracleConfig } from "../demo/scene-oracle.config.js";

@Injectable()
export class AggSourcePayloads {
  constructor(
    private readonly signer: PayloadSignerService,
    private readonly scene: SceneOracleConfig,
  ) {}
  /** Scene tokens carry a 3rd (mock) source registered on-chain; the mock ignores its payload, so append "0x". */
  async payloadsFor(tokens: readonly `0x${string}`[]): Promise<readonly `0x${string}`[][]> {
    return Promise.all(
      tokens.map(async (t) => {
        const base = await this.signer.payloadsFor(t);
        return this.scene.isSceneToken(t) ? [...base, "0x" as `0x${string}`] : base;
      }),
    );
  }
}
