import { Injectable } from "@nestjs/common";
import { MockSourceAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";
import { SceneOracleConfig } from "./scene-oracle.config.js";

export class DemoDisabledError extends Error {}

const DEPTH = 5_000_000n * 10n ** 18n;
const AMM_TWAP = 1;

@Injectable()
export class SceneOracleService {
  constructor(
    private readonly cfg: SceneOracleConfig,
    private readonly chain: ChainService,
  ) {}
  private now(): number { return Math.floor(Date.now() / 1000); }
  private mock(token: string): `0x${string}` {
    if (!this.cfg.enabled) throw new DemoDisabledError("demo mode off");
    const m = this.cfg.mockFor(token);
    if (!m) throw new DemoDisabledError(`not a scene token: ${token}`);
    return m as `0x${string}`;
  }
  async tamper(token: string, price: string): Promise<{ txHash: string }> {
    const mock = this.mock(token);
    const txHash = await this.chain.walletClient!.writeContract({
      address: mock, abi: MockSourceAbi as never, functionName: "set" as never,
      args: [BigInt(price), DEPTH, BigInt(this.now()), AMM_TWAP, 0n, true, true] as never,
      account: this.chain.account!, chain: this.chain.chain,
    });
    return { txHash };
  }
  async read(token: string): Promise<{ token: string; mockPrice: string }> {
    const mock = this.mock(token);
    const r = (await this.chain.publicClient.readContract({
      address: mock, abi: MockSourceAbi as never, functionName: "read", args: ["0x"],
    })) as { price: bigint };
    return { token, mockPrice: r.price.toString() };
  }
}
