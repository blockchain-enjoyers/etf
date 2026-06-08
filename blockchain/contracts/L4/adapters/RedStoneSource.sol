// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {SignedCommitteeBase} from "./SignedCommitteeBase.sol";
import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";

/// @title RedStoneSource — RedStone signed-pull median via the shared ecrecover committee (R13 §1)
/// @notice read(payload): decode the RedStone-format (feedId, price, lastUpdate, sigs), build RedStone's
///         digest, and require >= threshold distinct committee signers (e.g. 4-of-6). weekendAware=true for
///         the HyperStone equity-perp feed. Reuses SignedCommitteeBase (EP-2). The exact RedStone wire
///         packing is modeled here; reconcile against the canonical RedStone calldata layout before mainnet.
contract RedStoneSource is SignedCommitteeBase, IPriceSource {
    uint256 public immutable depthTier; // synthetic depth (oracle has no pool)
    bool public immutable weekendAware;

    error NonPositivePrice();

    constructor(address owner_, uint256 depthTier_, bool weekendAware_) SignedCommitteeBase(owner_) {
        depthTier = depthTier_;
        weekendAware = weekendAware_;
    }

    function read(bytes calldata payload) external view returns (SourceReading memory r) {
        (bytes32 feedId, uint256 price, uint64 lastUpdate, bytes32[] memory sr, bytes32[] memory ss, uint8[] memory sv) =
            abi.decode(payload, (bytes32, uint256, uint64, bytes32[], bytes32[], uint8[]));
        if (price == 0) revert NonPositivePrice();

        bytes32 h = keccak256(abi.encode("redstone", feedId, price, lastUpdate));
        if (_countValidSigners(h, sr, ss, sv) < threshold) revert ThresholdNotMet();

        r.price = price;
        r.depth = depthTier;
        r.lastUpdate = lastUpdate;
        r.kind = SourceKind.ORACLE_PULL;
        r.confidence = 0;
        r.weekendAware = weekendAware;
        r.healthy = true;
    }

    function describe() external view returns (string memory, address) {
        return ("redstone", address(this));
    }
}
