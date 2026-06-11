export type Capability = "CloneFactory" | "BasketVault" | "ManagedVault" | "CommittedVault" | "NAVEngine" | "OracleRouter" | "FairValueNAV" | "PriceAggregator" | "ManagedRebalanceVault" | "KeeperModule" | "RebalanceAuction" | "RebalanceObserver" | "RebalanceModule" | "ForwardCashQueue" | "BasketNavObserver" | "MockAPFiller";
export type AdapterKind = "live" | "fallback" | "null";

export interface CapabilityEntry {
  level: string;
  capability: Capability;
  port: string;
  absentPolicy: AdapterKind;
  l1Status: AdapterKind;
  note: string;
}

export const CAPABILITY_MATRIX: readonly CapabilityEntry[] = [
  { level: "L1", capability: "CloneFactory", port: "BasketCatalog", absentPolicy: "null", l1Status: "live", note: "list/detail from the read-model (indexer gated on CloneFactory presence)" },
  { level: "L1", capability: "BasketVault", port: "RedeemQuote", absentPolicy: "null", l1Status: "live", note: "settlement read — never falls back (iron rule)" },
  { level: "L1", capability: "BasketVault", port: "CreateQuote", absentPolicy: "null", l1Status: "live", note: "settlement read — never falls back (iron rule)" },
  { level: "L2/L4", capability: "NAVEngine", port: "NavSource", absentPolicy: "fallback", l1Status: "fallback", note: "off-chain signal NAV, estimated=true, until on-chain NAVEngine ships" },
  { level: "L4", capability: "NAVEngine", port: "FairValueSink", absentPolicy: "null", l1Status: "null", note: "off-chain attestation still ingested+stored; on-chain push dormant" },
  { level: "L3", capability: "RebalanceModule", port: "RebalanceWriter", absentPolicy: "null", l1Status: "null", note: "dormant — no rebalancing in L1" },
  { level: "L5", capability: "ForwardCashQueue", port: "ForwardQueue", absentPolicy: "null", l1Status: "null", note: "forward-cash queue — undeployed until the deployer key lands" },
  { level: "L5", capability: "BasketNavObserver", port: "ForwardQueue", absentPolicy: "null", l1Status: "null", note: "navPerShare TWAP for the g7 settle sanity band — undeployed at L1" },
  { level: "L5", capability: "MockAPFiller", port: "ForwardQueue", absentPolicy: "null", l1Status: "null", note: "testnet AP filler driven by the Forward Operator; prod APFiller is a contracts follow-up" },
] as const;
