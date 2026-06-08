// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {SignedCommitteeBase} from "./SignedCommitteeBase.sol";
import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

/// @title UniversalSignedSource — generic k-of-n ECDSA signed-report price source
/// @notice Verifies a committee-signed (feedId, price, depth, lastUpdate) reading via the shared
///         SignedCommitteeBase ecrecover core. Covers our own committee, a RedStone-style signer set, any
///         ECDSA signer. The digest is THIS adapter's; the committee + counting live in the base so
///         RedStone/Chronicle can reuse them with their own digests.
contract UniversalSignedSource is SignedCommitteeBase, IPriceSource {
    bool public weekendAware; // set true for sources that legitimately move while US equities are closed

    error NonPositivePrice();

    constructor(address owner_) SignedCommitteeBase(owner_) {}

    function setWeekendAware(bool w) external onlyOwner { weekendAware = w; }

    /// @inheritdoc IPriceSource
    function read(bytes calldata payload) external view returns (SourceReading memory r) {
        (bytes32 feedId, uint256 price, uint256 depth, uint64 lastUpdate,
         bytes32[] memory sr, bytes32[] memory ss, uint8[] memory sv) =
            abi.decode(payload, (bytes32, uint256, uint256, uint64, bytes32[], bytes32[], uint8[]));
        if (price == 0) revert NonPositivePrice();

        bytes32 h = keccak256(abi.encode("universal", feedId, price, depth, lastUpdate));
        if (_countValidSigners(h, sr, ss, sv) < threshold) revert ThresholdNotMet();

        r.price = price;
        r.depth = depth;
        r.lastUpdate = lastUpdate;
        r.kind = SourceKind.ORACLE_PULL;
        r.confidence = 0;
        r.weekendAware = weekendAware;
        r.healthy = true;
    }

    function describe() external view returns (string memory, address) {
        return ("universal-ecrecover", address(this));
    }
}
