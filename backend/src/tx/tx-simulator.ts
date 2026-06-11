import { Injectable } from "@nestjs/common";
import { ChainService } from "../chain/chain.service.js";

export interface SimSend { to: `0x${string}`; data: `0x${string}`; value: string; }

@Injectable()
export class TxSimulator {
  constructor(private readonly chain: ChainService) {}

  async simulate(send: SimSend, account: string, stateOverride?: unknown): Promise<boolean> {
    try {
      await this.chain.publicClient.call({
        account: account as `0x${string}`,
        to: send.to,
        data: send.data,
        value: BigInt(send.value),
        ...(stateOverride ? { stateOverride } : {}),
      } as never);
      return true;
    } catch {
      return false;
    }
  }
}
