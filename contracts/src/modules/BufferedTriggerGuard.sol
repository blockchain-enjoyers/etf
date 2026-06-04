// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBufferedTriggerGuard} from "../interfaces/IBufferedTriggerGuard.sol";

/// @title BufferedTriggerGuard
/// @notice The v2 safety layer (reused intent-validation engine). v1 = STUB. [R7 §4.4]
/// @dev Exposes the parameters and the e_max identity now so consumers can wire against the surface; the
///      enforcement logic (sustained-deviation TWAP with cardinality, listing gate with real depth, Dutch-
///      auction keeper tip+chip) is gated on the V0 GO/NO-GO and built in v2. [matrix #7]
contract BufferedTriggerGuard is IBufferedTriggerGuard {
    error NotImplemented();

    // hard-bounded params (road to immutability) [R7 §4.5]
    uint256 public exposureCapBps = 8_000; //  L = 0.80
    uint256 public bonusBps = 500; //          b = 5% baseline (8% weekend)
    uint256 public softBandBps = 100; //       +-1%
    uint256 public hardBandBps = 300; //       +-3% (up to 5%)
    uint32 public twapWindow = 1_800; //        30 min weekday (1-2h weekend)
    uint16 public minCardinality = 128; //      obs >= window/blockTime [R7 cardinality]

    function setParams(uint256 _exposureCapBps, uint256 _softBandBps, uint256 _hardBandBps) external {
        // v2: governor-gated with hard bounds. Stub setter for scaffolding.
        exposureCapBps = _exposureCapBps;
        softBandBps = _softBandBps;
        hardBandBps = _hardBandBps;
        emit ParamsUpdated(_exposureCapBps, _softBandBps, _hardBandBps);
    }

    /// @inheritdoc IBufferedTriggerGuard
    /// @dev v1 STUB: returns true so baskets can be created in the scaffold. v2 computes the real invariant
    ///      m*C1(delta,depth) > L*weight*delta*TVL at weekend-trough depth and may exclude/cap. [R7 top control]
    function checkListing(bytes32, address, uint256, uint256) external pure returns (bool passed) {
        passed = true;
    }

    /// @inheritdoc IBufferedTriggerGuard
    /// @dev e_max = 1/[L*(1+b)] - 1, scaled 1e18. With L=0.80, b=0.05 -> ~0.190476e18 (+19%). [R7]
    function maxAbsorbableErrorWad() external view returns (uint256) {
        // denom = L*(1+b) in 1e18 fixed point: (exposureCapBps/1e4) * (1 + bonusBps/1e4)
        uint256 lWad = (exposureCapBps * 1e18) / 10_000;
        uint256 onePlusBWad = 1e18 + (bonusBps * 1e18) / 10_000;
        uint256 denomWad = (lWad * onePlusBWad) / 1e18; // L*(1+b)
        if (denomWad >= 1e18) return 0; // no absorbable over-report headroom
        return (1e18 * 1e18) / denomWad - 1e18; // 1/denom - 1
    }

    /// @inheritdoc IBufferedTriggerGuard
    function isTriggered(bytes32) external pure returns (bool) {
        return false; // v1: never auto-triggers (read-only NAV, no binding settlement)
    }

    /// @inheritdoc IBufferedTriggerGuard
    function triggerForcedRedemption(bytes32) external pure {
        // v2: sustained-deviation check + Dutch-auction redemption paying keeper tip+chip. [R7]
        revert NotImplemented();
    }
}
