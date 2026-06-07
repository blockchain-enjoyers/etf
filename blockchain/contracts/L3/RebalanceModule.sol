// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RebalanceModule — is-due predicate + plan (compute side of compute->execute)
/// @notice Pure policy: decides whether a reweight is due (Schmitt-trigger over the observer TWAP drift)
///         and (in a future task) plans in-kind deltas toward target. It NEVER moves funds; the vault core
///         executes + gates. The latch state + lastRebalance live in the auction/vault (per-vault); this
///         module evaluates the predicate. This is the minimal is-due form; planRebalance / the provisioned
///         IRebalanceStrategy integration is a deferred follow-up.
contract RebalanceModule is Ownable {
    uint256 public triggerBandBps;
    uint256 public resetBandBps;
    uint256 public cooldown;
    uint256 public minCardinality;

    error InvalidBands();

    constructor(address o, uint256 trigger_, uint256 reset_, uint256 cooldown_, uint256 minCard_) Ownable(o) {
        if (trigger_ <= reset_) revert InvalidBands();
        triggerBandBps = trigger_; resetBandBps = reset_; cooldown = cooldown_; minCardinality = minCard_;
    }

    function setParams(uint256 trigger_, uint256 reset_, uint256 cooldown_, uint256 minCard_) external onlyOwner {
        if (trigger_ <= reset_) revert InvalidBands();
        triggerBandBps = trigger_; resetBandBps = reset_; cooldown = cooldown_; minCardinality = minCard_;
    }

    /// @notice Reweight is-due (Schmitt): fire when driftBps > trigger AND not already latched AND enough
    ///         cardinality AND cooldown elapsed. (The caller holds latch + lastRebalance state.)
    function evaluate(uint256 driftBps, uint256 cardinality, bool latched, uint256 sinceRebalance)
        external view returns (bool due)
    {
        if (cardinality < minCardinality) return false;
        if (sinceRebalance < cooldown) return false;
        if (latched) return false;
        return driftBps > triggerBandBps;
    }

    /// @notice Whether the latch should clear (drift fell below reset, by TWAP). Reset uses TWAP drift,
    ///         not instantaneous — the caller passes a TWAP-derived driftBps.
    function latchCleared(uint256 driftBps) external view returns (bool) {
        return driftBps < resetBandBps;
    }
}
