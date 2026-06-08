// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SignedCommitteeBase — reusable k-of-n ECDSA committee verification
/// @notice Committee management + strictly-ascending distinct-signer counting. Each signed-report adapter
///         (UniversalSignedSource, RedStoneSource, ChronicleSource) extends this and builds its OWN digest,
///         then calls `_countValidSigners`. Salvaged from CommitmentNAV's single-`last`-pointer trick.
abstract contract SignedCommitteeBase is Ownable {
    mapping(address => bool) public isCommittee;
    address[] internal _committee;
    uint256 public threshold;

    error ThresholdNotMet();

    constructor(address owner_) Ownable(owner_) {}

    function setCommittee(address[] calldata members, uint256 threshold_) external onlyOwner {
        for (uint256 i = 0; i < _committee.length; ++i) isCommittee[_committee[i]] = false;
        _committee = members;
        for (uint256 i = 0; i < members.length; ++i) isCommittee[members[i]] = true;
        threshold = threshold_;
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
