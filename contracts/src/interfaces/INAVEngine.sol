// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title INAVEngine
/// @notice Computes basket NAV and the confidence band. Read-only/informational in v1. [R4 §4.3]
/// @dev v1: market-hours weighted sum over OracleRouter; weekend/stale => estimated=true, band widened, NOT
///      a settlement input. v2: closed-market fair value reads an OFF-CHAIN beta attestation (no on-chain
///      regression). IRON RULE: NavResult.estimated==true is NEVER a settlement price. [R4]
interface INAVEngine {
    event FairValueAttestationSet(bytes32 indexed basketId, bytes32 attestationHash, uint64 timestamp);

    error AttestationStale(bytes32 basketId);
    error AttestationMissing(bytes32 basketId);

    /// @notice Current NAV for a basket. Always safe to call; honor `estimated`. [R4]
    function latestNAV(bytes32 basketId) external view returns (MeridianTypes.NavResult memory);

    /// @notice Convenience: just the market status the NAV was computed under.
    function marketStatus(bytes32 basketId) external view returns (MeridianTypes.MarketStatus);

    /// @notice v2 — push an off-chain-fitted fair-value attestation (betas + signal returns already applied).
    /// @dev Engine stores/validates it; it never recomputes the regression on-chain. [R4/R6]
    function setFairValueAttestation(
        bytes32 basketId,
        uint256 nav,
        uint256 confidenceLower,
        uint256 confidenceUpper,
        uint64 timestamp,
        bytes calldata signature
    ) external;
}
