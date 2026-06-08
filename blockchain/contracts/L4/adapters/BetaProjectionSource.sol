// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {SignedCommitteeBase} from "./SignedCommitteeBase.sol";
import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

interface IIndexReturnLike {
    function indexReturn() external view returns (int256);
}

/// @title BetaProjectionSource — fund-attested beta projection (info/veto, NOT a median source) (R13 §7)
/// @notice read(payload): verify the fund's signature over (feedId, beta, lastClose), read an ON-CHAIN
///         index return r_index, and compute P̂ = lastClose·(1 + β·r_index). We NEVER compute β — the fund
///         supplies and signs it. Per EP-3 this is NOT registered in PriceAggregator's median set (a
///         low-depth median source would simply be ignored); FairValueNAV.navWithBetaCheck consumes it as a
///         cross-check / veto. `depthTier` is deliberately low (info-only).
contract BetaProjectionSource is SignedCommitteeBase, IPriceSource {
    IIndexReturnLike public immutable index;
    uint256 public immutable depthTier; // deliberately low: info/veto, never majority depth

    error NonPositiveProjection();

    constructor(address owner_, address index_, uint256 depthTier_) SignedCommitteeBase(owner_) {
        index = IIndexReturnLike(index_);
        depthTier = depthTier_;
    }

    function read(bytes calldata payload) external view returns (SourceReading memory r) {
        (bytes32 feedId, int256 beta, uint256 lastClose, bytes32[] memory sr, bytes32[] memory ss, uint8[] memory sv) =
            abi.decode(payload, (bytes32, int256, uint256, bytes32[], bytes32[], uint8[]));

        bytes32 h = keccak256(abi.encode("beta-projection", feedId, beta, lastClose));
        if (_countValidSigners(h, sr, ss, sv) < threshold) revert ThresholdNotMet();

        int256 rIndex = index.indexReturn(); // 1e18
        int256 factor = int256(1e18) + (beta * rIndex) / 1e18; // 1 + β·r_index, 1e18
        int256 pHat = (int256(lastClose) * factor) / 1e18;
        if (pHat <= 0) revert NonPositiveProjection();

        r.price = uint256(pHat);
        r.depth = depthTier;
        r.confidence = 0;
        r.lastUpdate = uint64(block.timestamp);
        r.kind = SourceKind.ORACLE_PULL;
        r.weekendAware = true;
        r.healthy = true;
    }

    function describe() external view returns (string memory, address) {
        return ("beta-projection", address(this));
    }
}
