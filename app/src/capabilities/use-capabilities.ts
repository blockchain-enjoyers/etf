import { useAccount, useChainId } from "wagmi";
import { addresses } from "@meridian/contracts";
import type { MarketStatus, TxAction } from "@meridian/sdk";
import { useAvailability } from "../data/useAvailability";

type Cap = "CloneFactory" | "BasketVault" | "ForwardCashQueue";
export type Reason =
  | "ok"
  | "not-deployed"
  | "not-bootstrapped"
  | "wrong-chain"
  | "wallet-disconnected"
  | "market-closed"
  | "frozen"
  | "manager-mismatch";

export type Gate = { enabled: boolean; reason: Reason };

type Capabilities = {
  status(cap: Cap): "live" | "absent";
  canMint(vaultAddress: string, frozen?: boolean): Gate;
  canRedeemInKind(): Gate;
  canRedeemCash(): Gate;
  canDeploy(): Gate;
  canCurate(manager: string): Gate;
  canForwardCreate(vaultAddress: string, bootstrapped: boolean): Gate;
  canForwardRedeem(): Gate;
  canForwardCancel(): Gate;
  canForwardKeeper(manager: string): Gate;
};

export function useCapabilities(marketStatus: MarketStatus, vaultAddress?: string): Capabilities {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { data: avail } = useAvailability(vaultAddress ?? "", address);

  const chainAddresses =
    chainId in addresses
      ? addresses[chainId as keyof typeof addresses]
      : ({} as Record<string, `0x${string}`>);

  // Apply the backend's per-vault verdict on top of the local checks. With no vaultAddress (hook
  // disabled) or no data loaded, `avail` is undefined and this returns ok — identical to local-only.
  function backendGate(action: TxAction): Gate {
    const item = avail?.items.find((i) => i.action === action);
    if (!item || item.enabled) return { enabled: true, reason: "ok" };
    const map: Record<string, Reason> = {
      frozen: "frozen", "manager-mismatch": "manager-mismatch", "not-deployed": "not-deployed",
      "market-closed": "market-closed", halted: "market-closed", "not-authorized": "manager-mismatch",
      "nothing-pending": "ok", "unsupported-vault-type": "not-deployed", ok: "ok",
    };
    // ?? keeps an unrecognised backend reason from crashing the gate (falls back to ok).
    return { enabled: false, reason: map[item.reason] ?? "ok" };
  }

  function status(cap: Cap): "live" | "absent" {
    return chainAddresses[cap] !== undefined ? "live" : "absent";
  }

  function canMint(vaultAddress: string, frozen?: boolean): Gate {
    if (!(chainId in addresses)) {
      return { enabled: false, reason: "wrong-chain" };
    }
    // Vaults are per-basket EIP-1167 clones — there is no singleton BasketVault address.
    // The CloneFactory being present means the system is live on this chain;
    // the specific vault is `vaultAddress` (checked below).
    if (chainAddresses["CloneFactory"] === undefined) {
      return { enabled: false, reason: "not-deployed" };
    }
    if (!isConnected) {
      return { enabled: false, reason: "wallet-disconnected" };
    }
    if (!vaultAddress) {
      return { enabled: false, reason: "not-deployed" };
    }
    if (frozen) {
      return { enabled: false, reason: "frozen" };
    }
    return backendGate("mint");
  }

  // IRON RULE: in-kind redeem is NEVER gated by market state.
  function canRedeemInKind(): Gate {
    if (!isConnected) {
      return { enabled: false, reason: "wallet-disconnected" };
    }
    return { enabled: true, reason: "ok" };
  }

  function canRedeemCash(): Gate {
    if (!isConnected) {
      return { enabled: false, reason: "wallet-disconnected" };
    }
    if (marketStatus !== "regular") {
      return { enabled: false, reason: "market-closed" };
    }
    return { enabled: true, reason: "ok" };
  }

  function canDeploy(): Gate {
    if (!(chainId in addresses)) {
      return { enabled: false, reason: "wrong-chain" };
    }
    if (chainAddresses["CloneFactory"] === undefined) {
      return { enabled: false, reason: "not-deployed" };
    }
    if (!isConnected) {
      return { enabled: false, reason: "wallet-disconnected" };
    }
    return { enabled: true, reason: "ok" };
  }

  function canCurate(manager: string): Gate {
    if (!(chainId in addresses)) return { enabled: false, reason: "wrong-chain" };
    if (chainAddresses["CloneFactory"] === undefined) return { enabled: false, reason: "not-deployed" };
    if (!isConnected || !address) return { enabled: false, reason: "wallet-disconnected" };
    if (address.toLowerCase() !== manager.toLowerCase()) return { enabled: false, reason: "manager-mismatch" };
    return backendGate("curatorSchedule");
  }

  function canForwardCreate(vaultAddress: string, bootstrapped: boolean): Gate {
    if (!(chainId in addresses)) return { enabled: false, reason: "wrong-chain" };
    if (chainAddresses["CloneFactory"] === undefined) return { enabled: false, reason: "not-deployed" };
    if (!isConnected) return { enabled: false, reason: "wallet-disconnected" };
    if (!vaultAddress) return { enabled: false, reason: "not-deployed" };
    // The vault is deployed but its genesis basket hasn't been seeded yet — distinct from not-deployed
    // so the banner can point the user at the in-kind bootstrap (Liquidity → Create shares in-kind).
    if (!bootstrapped) return { enabled: false, reason: "not-bootstrapped" };
    return backendGate("forwardCreate");
  }

  function canForwardRedeem(): Gate {
    if (!isConnected) return { enabled: false, reason: "wallet-disconnected" };
    return { enabled: true, reason: "ok" };
  }

  function canForwardCancel(): Gate {
    if (!isConnected) return { enabled: false, reason: "wallet-disconnected" };
    return { enabled: true, reason: "ok" };
  }

  function canForwardKeeper(manager: string): Gate {
    if (!(chainId in addresses)) return { enabled: false, reason: "wrong-chain" };
    if (chainAddresses["CloneFactory"] === undefined) return { enabled: false, reason: "not-deployed" };
    if (!isConnected || !address) return { enabled: false, reason: "wallet-disconnected" };
    if (address.toLowerCase() !== manager.toLowerCase()) return { enabled: false, reason: "manager-mismatch" };
    return backendGate("keeperSettle");
  }

  return {
    status, canMint, canRedeemInKind, canRedeemCash, canDeploy, canCurate,
    canForwardCreate, canForwardRedeem, canForwardCancel, canForwardKeeper,
  };
}
