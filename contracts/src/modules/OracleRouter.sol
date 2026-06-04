// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {IOracleAdapter} from "../interfaces/IOracleAdapter.sol";
import {ISequencerUptimeFeed} from "../interfaces/external/ISequencerUptimeFeed.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title OracleRouter
/// @notice v1 oracle surface: Chainlink anchor + staleness + L2 sequencer gating. [R5/R7]
/// @dev IMPLEMENTED v1 (single-source Chainlink + sequencer + staleness). SKELETON for v2: multi-source
///      fusion + divergence checks across Pyth/RedStone/DEX-TWAP/perp adapters (revert NotImplemented in
///      the fusion path). NEVER returns a single-source price as settlement-grade; consumers honor `estimated`.
contract OracleRouter is IOracleRouter {
    error NotImplemented();

    address public owner;
    ISequencerUptimeFeed public sequencerFeed;
    uint64 public sequencerGracePeriod; // seconds after recovery before trusting the feed [R7]
    uint64 public staleThreshold; //      seconds; reading older than this is stale

    mapping(uint8 => IOracleAdapter) internal _adapter; // OracleSource => adapter

    constructor(address _owner, address _sequencerFeed, uint64 _gracePeriod, uint64 _staleThreshold) {
        owner = _owner;
        sequencerFeed = ISequencerUptimeFeed(_sequencerFeed);
        sequencerGracePeriod = _gracePeriod;
        staleThreshold = _staleThreshold;
    }

    // -- admin ---------------------------------------------------------------

    function registerAdapter(MeridianTypes.OracleSource source, address adapter) external {
        require(msg.sender == owner, "Router: not owner");
        _adapter[uint8(source)] = IOracleAdapter(adapter);
        emit AdapterRegistered(source, adapter);
    }

    function setSequencerFeed(address feed, uint64 gracePeriod) external {
        require(msg.sender == owner, "Router: not owner");
        sequencerFeed = ISequencerUptimeFeed(feed);
        sequencerGracePeriod = gracePeriod;
        emit SequencerFeedSet(feed, gracePeriod);
    }

    function setStaleThreshold(uint64 t) external {
        require(msg.sender == owner, "Router: not owner");
        staleThreshold = t;
    }

    // -- reads ---------------------------------------------------------------

    /// @inheritdoc IOracleRouter
    function getPrice(address asset) external view returns (MeridianTypes.OracleReading memory r) {
        checkSequencer();
        r = _chainlink(asset);
        uint64 age = uint64(block.timestamp) - r.timestamp;
        if (age > staleThreshold) revert StaleReading(asset, age);
        // v2: fuse Pyth/RedStone/DEX-TWAP/perp here + divergence checks before returning. [R5]
    }

    /// @inheritdoc IOracleRouter
    function lastReading(address asset) external view returns (MeridianTypes.OracleReading memory) {
        // non-reverting on staleness; informational NAV path. [R4]
        return _chainlink(asset);
    }

    /// @inheritdoc IOracleRouter
    function marketStatus(address asset) external view returns (MeridianTypes.MarketStatus) {
        return _chainlink(asset).marketStatus;
    }

    /// @inheritdoc IOracleRouter
    function isFreshRegular(address asset) external view returns (bool) {
        // sequencer must be healthy
        (, int256 answer, uint256 startedAt,,) = sequencerFeed.latestRoundData();
        if (answer != 0) return false;
        if (block.timestamp - startedAt < sequencerGracePeriod) return false;

        MeridianTypes.OracleReading memory r = _chainlink(asset);
        if (r.marketStatus != MeridianTypes.MarketStatus.Regular) return false;
        if (uint64(block.timestamp) - r.timestamp > staleThreshold) return false;
        return true;
    }

    /// @inheritdoc IOracleRouter
    function checkSequencer() public view {
        (, int256 answer, uint256 startedAt,,) = sequencerFeed.latestRoundData();
        if (answer != 0) revert SequencerDown();
        uint256 sinceUp = block.timestamp - startedAt;
        if (sinceUp < sequencerGracePeriod) revert SequencerGracePeriod(uint64(sequencerGracePeriod - sinceUp));
    }

    /// @notice v2 multi-source fused reading (depth-weighted, divergence-checked). Not built yet. [R5]
    function getFusedPrice(address) external pure returns (MeridianTypes.OracleReading memory) {
        revert NotImplemented();
    }

    function _chainlink(address asset) internal view returns (MeridianTypes.OracleReading memory) {
        IOracleAdapter a = _adapter[uint8(MeridianTypes.OracleSource.Chainlink)];
        if (address(a) == address(0) || !a.isAvailable(asset)) revert NoFreshSource(asset);
        return a.read(asset);
    }
}
