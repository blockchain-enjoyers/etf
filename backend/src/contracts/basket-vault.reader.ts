import { Injectable } from "@nestjs/common";
import { BasketVaultAbi } from "@meridian/contracts";
import { ChainService } from "../chain/chain.service.js";

export interface VaultConstituent {
  token: `0x${string}`;
  unitQty: bigint;
}

export interface TokenAmount {
  token: `0x${string}`;
  amount: bigint;
}

@Injectable()
export class BasketVaultReader {
  readonly abi = BasketVaultAbi;

  constructor(private readonly chain: ChainService) {}

  async getConstituents(vault: `0x${string}`): Promise<VaultConstituent[]> {
    const [tokens, unitQty] = await this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "getConstituents",
    });
    return tokens.map((token, i) => ({ token, unitQty: unitQty[i]! }));
  }

  async previewCreate(vault: `0x${string}`, nUnits: bigint): Promise<TokenAmount[]> {
    const [tokens, amounts] = await this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "previewCreate",
      args: [nUnits],
    });
    return tokens.map((token, i) => ({ token, amount: amounts[i]! }));
  }

  async previewRedeem(vault: `0x${string}`, amount: bigint): Promise<TokenAmount[]> {
    const [tokens, amounts] = await this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "previewRedeem",
      args: [amount],
    });
    return tokens.map((token, i) => ({ token, amount: amounts[i]! }));
  }

  async unitSize(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "unitSize",
    });
  }

  async totalSupply(vault: `0x${string}`): Promise<bigint> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "totalSupply",
    });
  }

  async name(vault: `0x${string}`): Promise<string> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "name",
    });
  }

  async symbol(vault: `0x${string}`): Promise<string> {
    return this.chain.publicClient.readContract({
      address: vault,
      abi: BasketVaultAbi,
      functionName: "symbol",
    });
  }
}
