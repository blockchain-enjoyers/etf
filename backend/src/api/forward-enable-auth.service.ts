import { Injectable, Optional } from "@nestjs/common";
import { recoverTypedDataAddress } from "viem";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { ChainService } from "../chain/chain.service.js";
import { paramsHashOf, type EnableParams } from "./forward-enable.params.js";

export class ForwardEnableAuthError extends Error {}

@Injectable()
export class ForwardEnableAuthService {
  constructor(
    private readonly reader: ManagedRebalanceVaultReader,
    private readonly repo: IndexerRepository,
    private readonly chain: ChainService,
    @Optional() private readonly opts: { nowSec: () => number } = { nowSec: () => Math.floor(Date.now() / 1000) },
  ) {}

  async verify(
    vault: string,
    params: EnableParams,
    sig: { nonce: string; expiry: number; signature: `0x${string}` },
  ): Promise<string> {
    if (sig.expiry <= this.opts.nowSec()) throw new ForwardEnableAuthError("request expired");
    if (await this.repo.isNonceUsed(vault, sig.nonce)) throw new ForwardEnableAuthError("nonce already used");
    const recovered = await recoverTypedDataAddress({
      domain: { name: "Meridian", version: "1", chainId: this.chain.chain.id, verifyingContract: vault as `0x${string}` },
      types: {
        EnableCashSettlement: [
          { name: "vault", type: "address" },
          { name: "paramsHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      primaryType: "EnableCashSettlement",
      message: {
        vault: vault as `0x${string}`,
        paramsHash: paramsHashOf(params),
        nonce: BigInt(sig.nonce),
        expiry: BigInt(sig.expiry),
      },
      signature: sig.signature,
    });
    const manager = await this.reader.manager(vault as `0x${string}`);
    if (recovered.toLowerCase() !== manager.toLowerCase())
      throw new ForwardEnableAuthError("signer is not the vault manager");
    await this.repo.markNonceUsed(vault, sig.nonce);
    return manager;
  }
}
