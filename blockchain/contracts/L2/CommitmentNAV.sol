// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CommitmentNAV — stateless basket valuation via a recipe commitment + calldata
/// @notice Stores only keccak256(abi.encode(tokens, unitQty, unitSize)) (32 bytes). The recipe and
///         prices are supplied in calldata and validated against the commitment, so there is no
///         per-constituent storage (no deploy wall, no "units read"). B1 trusts the supplied prices;
///         B2 adds inline DON-signature verification for price correctness.
contract CommitmentNAV is Ownable {
    bytes32 public immutable recipeCommitment;

    mapping(address => bool) public isCommittee;
    address[] private _committee;
    uint256 public threshold;

    error RecipeMismatch();
    error LengthMismatch();
    error ThresholdNotMet();

    constructor(address[] memory tokens, uint256[] memory unitQty, uint256 unitSize)
        Ownable(msg.sender)
    {
        recipeCommitment = keccak256(abi.encode(tokens, unitQty, unitSize));
    }

    // ============================== CONFIG ==============================

    /// @notice Register the DON committee (members and threshold). Owner-gated; one-time during
    ///         the B2 trusted-price -> signed-price migration.
    /// @param members   Strictly-ascending committee addresses (allows the ecrecover loop to enforce
    ///                  distinct signers with a single `last` pointer).
    /// @param threshold_ Minimum number of valid distinct signatures required.
    function setCommittee(address[] calldata members, uint256 threshold_) external onlyOwner {
        for (uint256 i = 0; i < _committee.length; ++i) isCommittee[_committee[i]] = false;
        _committee = members;
        for (uint256 i = 0; i < members.length; ++i) isCommittee[members[i]] = true;
        threshold = threshold_;
    }

    // ============================== B1 — trusted-price path ==============================

    /// @notice Compute basket NAV from calldata-supplied prices, validated against the stored
    ///         commitment. No signature checks — caller is trusted (e.g. a keeper / L2 system).
    /// @param tokens   Asset addresses (must match the constructor recipe exactly).
    /// @param unitQty  Per-unit quantities in 1e18 (must match the constructor recipe exactly).
    /// @param unitSize Unit size (must match the constructor recipe exactly).
    /// @param prices   1e18-scaled USD per whole unit, aligned to `tokens`.
    /// @return nav     Σ unitQty_i·price_i / 1e18 (1e18-USD).
    function navFromCalldata(
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        int256[] calldata prices
    ) external view returns (uint256 nav) {
        if (keccak256(abi.encode(tokens, unitQty, unitSize)) != recipeCommitment) revert RecipeMismatch();
        uint256 n = tokens.length;
        if (unitQty.length != n || prices.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; ++i) {
            nav += (uint256(prices[i]) * unitQty[i]) / 1e18;
        }
    }

    // ============================== B2 — inline DON-threshold verify path ==============================

    /// @notice Per-report price + DON signatures, grouped into one calldata struct.
    /// @dev    Grouping these five arrays into a struct keeps `navFromSignedReports` within the legacy
    ///         codegen stack-slot limit (so the repo never needs viaIR). Signatures are flattened per
    ///         report: r[i]/s[i]/v[i] are the k-length signature components for report i.
    struct SignedReports {
        bytes32[] feedIds; // one feed-id per token
        int256[] mids; // mid prices in 1e18 (DON-attested), aligned to feedIds
        bytes32[][] r; // per-report, per-signer ECDSA r
        bytes32[][] s; // per-report, per-signer ECDSA s
        uint8[][] v; // per-report, per-signer ECDSA v
    }

    /// @notice Verify k DON signatures per report (against the committee), then sum unitQty·mid.
    /// @dev    Callers must sort their signing wallets by address (ascending) before signing so the
    ///         recovered addresses arrive strictly increasing (the distinct-signer check uses a single
    ///         `last` pointer, not a visited-set mapping — gas-free, O(1) state).
    /// @param tokens   Asset addresses (validated against the commitment).
    /// @param unitQty  Per-unit quantities in 1e18.
    /// @param unitSize Unit size.
    /// @param reps     Per-report prices + signatures (see SignedReports).
    /// @return nav     Σ unitQty_i·mid_i / 1e18 (1e18-USD).
    function navFromSignedReports(
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        SignedReports calldata reps
    ) external view returns (uint256 nav) {
        if (keccak256(abi.encode(tokens, unitQty, unitSize)) != recipeCommitment) revert RecipeMismatch();
        uint256 n = tokens.length;
        if (unitQty.length != n || reps.feedIds.length != n || reps.mids.length != n) revert LengthMismatch();

        uint256 t = threshold;
        for (uint256 i = 0; i < n; ++i) {
            bytes32 h = keccak256(abi.encode(reps.feedIds[i], reps.mids[i]));
            if (_countValidSigners(h, reps.r[i], reps.s[i], reps.v[i]) < t) revert ThresholdNotMet();
            nav += (uint256(reps.mids[i]) * unitQty[i]) / 1e18;
        }
    }

    /// @dev Count distinct committee signers over hash `h`. Strictly-increasing recovered addresses
    ///      guarantee distinctness; `ecrecover` returns address(0) on a bad signature, which is never
    ///      a committee member and never > the initial `last`, so it is ignored. Extracting this loop
    ///      keeps the caller's stack small.
    function _countValidSigners(
        bytes32 h,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint8[] calldata v
    ) internal view returns (uint256 valid) {
        address last = address(0);
        for (uint256 j = 0; j < r.length; ++j) {
            address signer = ecrecover(h, v[j], r[j], s[j]);
            if (signer > last && isCommittee[signer]) {
                last = signer;
                unchecked { ++valid; }
            }
        }
    }
}
