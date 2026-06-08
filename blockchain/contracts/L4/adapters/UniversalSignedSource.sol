// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

/// @title UniversalSignedSource — generic k-of-n ECDSA signed-report price source
/// @notice Verifies a committee-signed (feedId, price, depth, lastUpdate) reading via ecrecover. Covers
///         our own committee, a RedStone-style signer set, any ECDSA signer. Salvaged from CommitmentNAV's
///         strictly-ascending distinct-signer trick (gas-free distinctness via a single `last` pointer).
contract UniversalSignedSource is Ownable, IPriceSource {
    mapping(address => bool) public isCommittee;
    address[] private _committee;
    uint256 public threshold;
    bool public weekendAware; // set true for sources that legitimately move while US equities are closed

    error ThresholdNotMet();
    error NonPositivePrice();

    constructor(address owner_) Ownable(owner_) {}

    function setCommittee(address[] calldata members, uint256 threshold_) external onlyOwner {
        for (uint256 i = 0; i < _committee.length; ++i) isCommittee[_committee[i]] = false;
        _committee = members;
        for (uint256 i = 0; i < members.length; ++i) isCommittee[members[i]] = true;
        threshold = threshold_;
    }

    function setWeekendAware(bool w) external onlyOwner { weekendAware = w; }

    /// @inheritdoc IPriceSource
    function read(bytes calldata payload) external view returns (SourceReading memory r) {
        (bytes32 feedId, uint256 price, uint256 depth, uint64 lastUpdate,
         bytes32[] memory sr, bytes32[] memory ss, uint8[] memory sv) =
            abi.decode(payload, (bytes32, uint256, uint256, uint64, bytes32[], bytes32[], uint8[]));
        if (price == 0) revert NonPositivePrice();

        bytes32 h = keccak256(abi.encode(feedId, price, depth, lastUpdate));
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

    /// @dev Count distinct committee signers over `h`. Strictly-increasing recovered addresses guarantee
    ///      distinctness with a single `last` pointer; ecrecover returns address(0) on a bad signature,
    ///      never a committee member and never > the initial `last`, so it is ignored.
    function _countValidSigners(bytes32 h, bytes32[] memory r, bytes32[] memory s, uint8[] memory v)
        internal view returns (uint256 valid)
    {
        address last = address(0);
        for (uint256 j = 0; j < r.length; ++j) {
            address signer = ecrecover(h, v[j], r[j], s[j]);
            if (signer > last && isCommittee[signer]) { last = signer; unchecked { ++valid; } }
        }
    }
}
