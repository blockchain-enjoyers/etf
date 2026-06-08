// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {SignedCommitteeBase} from "./SignedCommitteeBase.sol";
import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

/// @title ChronicleSource — Chronicle signed-median oracle via the shared ecrecover committee (R13 §1)
/// @notice read(payload): decode Chronicle's (feedId, price, lastUpdate, sigs), build Chronicle's digest,
///         require >= threshold distinct scribe (committee) signatures. Reuses SignedCommitteeBase (EP-2).
///         The digest is domain-separated from RedStone's so the same committee key set is not cross-usable.
contract ChronicleSource is SignedCommitteeBase, IPriceSource {
    uint256 public immutable depthTier;

    error NonPositivePrice();

    constructor(address owner_, uint256 depthTier_) SignedCommitteeBase(owner_) {
        depthTier = depthTier_;
    }

    function read(bytes calldata payload) external view returns (SourceReading memory r) {
        (bytes32 feedId, uint256 price, uint64 lastUpdate, bytes32[] memory sr, bytes32[] memory ss, uint8[] memory sv) =
            abi.decode(payload, (bytes32, uint256, uint64, bytes32[], bytes32[], uint8[]));
        if (price == 0) revert NonPositivePrice();

        bytes32 h = keccak256(abi.encode("chronicle", feedId, price, lastUpdate));
        if (_countValidSigners(h, sr, ss, sv) < threshold) revert ThresholdNotMet();

        r.price = price;
        r.depth = depthTier;
        r.lastUpdate = lastUpdate;
        r.kind = SourceKind.ORACLE_PULL;
        r.confidence = 0;
        r.weekendAware = false;
        r.healthy = true;
    }

    function describe() external view returns (string memory, address) {
        return ("chronicle", address(this));
    }
}
