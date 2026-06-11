import { Injectable } from "@nestjs/common";
import {
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConfigService } from "../config/config.service.js";
import { defineRhcChain } from "./chain.constants.js";

@Injectable()
export class ChainService {
  /** The RHC chain definition (id 46630 + multicall3). */
  readonly chain: Chain;
  /** Read client used by all contract readers + on-chain adapters. */
  readonly publicClient: PublicClient;
  /** Optional signer; only present when KEEPER_PRIVATE_KEY is set (v2 keepers). */
  readonly walletClient?: WalletClient;
  readonly account?: Account;

  constructor(private readonly config: ConfigService) {
    this.chain = defineRhcChain({
      chainId: this.config.get("CHAIN_ID"),
      rpcUrl: this.config.get("RHC_RPC_URL"),
      multicall3Address: this.config.get("MULTICALL3_ADDRESS") as `0x${string}`,
    });
    const transport = http(this.config.get("RHC_RPC_URL"));
    this.publicClient = createPublicClient({ chain: this.chain, transport });

    const pk = this.config.get("KEEPER_PRIVATE_KEY");
    if (pk) {
      this.account = privateKeyToAccount(pk as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport,
      });
    }
  }
}
