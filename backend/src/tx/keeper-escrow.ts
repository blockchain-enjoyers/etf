const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * Rebalance/registry vaults revert ZeroEscrow() when keeperBps > 0 but keeperEscrow is address(0).
 * Keeper-fee shares accrue to the escrow, so when the wizard omits it we default to the manager.
 * Used by both the deploy-preview simulate and the real deploy tx so they always agree.
 */
export function resolveKeeperEscrow(
  keeperBps: number,
  keeperEscrow: string | undefined,
  manager: `0x${string}`,
): `0x${string}` {
  if (keeperBps > 0 && (!keeperEscrow || keeperEscrow.toLowerCase() === ZERO_ADDRESS)) return manager;
  return (keeperEscrow ?? ZERO_ADDRESS) as `0x${string}`;
}
