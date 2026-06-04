// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IBufferedTriggerGuard
/// @notice The safety layer reused from the intent-validation engine. Treats NAV as a trigger BAND, not a
///         settlement value; force-redeem/rebalance only on SUSTAINED (TWAP) deviation. [R7 §4.4]
/// @dev v1: interface / stub only (gated on V0). v2: full logic — buffered-trigger e_max, listing gate,
///      sustained-deviation TWAP with cardinality, Dutch-auction keeper tip+chip. [R7]
interface IBufferedTriggerGuard {
    event ListingChecked(bytes32 indexed basketId, address constituent, bool passed);
    event ForcedRedemptionTriggered(bytes32 indexed basketId, uint256 deviationBps);
    event ParamsUpdated(uint256 exposureCapBps, uint256 softBandBps, uint256 hardBandBps);

    error ListingGateFailed(address constituent);
    error DeviationNotSustained(uint256 observedBps, uint256 windowSeconds);
    error InsufficientTwapCardinality(uint16 have, uint16 need);
    error WithinBand(uint256 deviationBps);

    /// @notice Listing gate: m*C1(delta,depth) > L*weight*delta*TVL at weekend-trough depth. [R7 top control]
    /// @return passed true if the constituent can be safely listed at `weightBps`.
    function checkListing(bytes32 basketId, address constituent, uint256 weightBps, uint256 tvl)
        external
        view
        returns (bool passed);

    /// @notice Max absorbable NAV over-report e_max = 1/[L*(1+b)] - 1, scaled 1e18. [R7]
    function maxAbsorbableErrorWad() external view returns (uint256);

    /// @notice Whether a sustained deviation beyond the hard band has been observed over the TWAP window.
    function isTriggered(bytes32 basketId) external view returns (bool);

    /// @notice Execute a forced (Dutch-auction) redemption when triggered; pays keeper tip+chip. [R7]
    function triggerForcedRedemption(bytes32 basketId) external;

    // -- params (hard-bounded, road to immutability) -------------------------
    function exposureCapBps() external view returns (uint256); //  L, default 8000 (0.80)
    function softBandBps() external view returns (uint256); //     +-1%
    function hardBandBps() external view returns (uint256); //     +-3-5%
    function twapWindow() external view returns (uint32); //       30m weekday / 1-2h weekend
}
