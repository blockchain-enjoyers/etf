// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {IOracleAdapter} from "./interfaces/IOracleAdapter.sol";
import {ISequencerUptimeFeed} from "./interfaces/ISequencerUptimeFeed.sol";
import {OracleReading, MarketStatus, MarketStatusLib} from "./OracleTypes.sol";

/// @title OracleRouter — staleness + market-status + sequencer gate over cached readings
/// @notice Step 2 of the L2 read-price chain. It resolves asset -> feedId, drives the adapter to
///         INGEST verified readings into an on-chain cache (the pull-model bridge to view-NAV), and on
///         every read GATES the cached reading: it downgrades marketStatus to Halted when the price is
///         stale past threshold, or Degraded when the L2 sequencer is down / within its restart grace.
///         NAVEngine reads getPrice() as a pure view; the freshness work happened at ingest time.
/// @dev Why a cache: Data Streams is pull-based and verify() is non-view, so a view NAV cannot verify
///      inline. A keeper calls ingest(asset, signedReport) (free + permissionless on the RHC testnet)
///      to refresh the cache; getPrice() then stays view. ingest is monotonic in report timestamp to
///      stop anyone replaying an OLD (still validly-signed) report to roll the cache backwards.
contract OracleRouter is IOracleRouter, Ownable {
    using MarketStatusLib for MarketStatus;

    /// @notice The normalizing adapter (Chainlink Data Streams today; L4 fair-value later).
    IOracleAdapter public immutable adapter;
    /// @notice The L2 Sequencer Uptime Feed (classic Data Feed). May be address(0) to disable the gate
    ///         (e.g. local tests / non-L2 deployments).
    ISequencerUptimeFeed public immutable sequencerUptimeFeed;
    /// @notice Seconds after a sequencer restart during which prices are still treated as Degraded.
    uint256 public immutable sequencerGracePeriod;
    /// @notice Max age (seconds) of a reading before an Open market is downgraded to Halted.
    uint256 public immutable stalenessThreshold;

    /// @notice asset -> the feed/stream id it must resolve to.
    mapping(address => bytes32) public feedIdOf;
    /// @notice asset -> last ingested normalized reading.
    mapping(address => OracleReading) private _cache;
    /// @notice asset -> block timestamp at which the reading was ingested (cache-age clock).
    mapping(address => uint256) private _cachedAt;

    event FeedSet(address indexed asset, bytes32 indexed feedId);
    event Ingested(address indexed asset, int256 price, uint256 timestamp, MarketStatus marketStatus);

    error FeedNotSet(address asset);
    error NoReading(address asset);
    error RollbackReport(uint256 cachedTimestamp, uint256 incomingTimestamp);

    /// @param adapter_              the normalizing price adapter.
    /// @param sequencerUptimeFeed_  L2 sequencer uptime feed (address(0) to disable the rail gate).
    /// @param sequencerGracePeriod_ grace seconds after sequencer restart (e.g. 3600).
    /// @param stalenessThreshold_   max reading age before Open -> Halted (e.g. weekday heartbeat + buffer).
    /// @param initialOwner          owner allowed to register feeds.
    constructor(
        IOracleAdapter adapter_,
        ISequencerUptimeFeed sequencerUptimeFeed_,
        uint256 sequencerGracePeriod_,
        uint256 stalenessThreshold_,
        address initialOwner
    ) Ownable(initialOwner) {
        adapter = adapter_;
        sequencerUptimeFeed = sequencerUptimeFeed_;
        sequencerGracePeriod = sequencerGracePeriod_;
        stalenessThreshold = stalenessThreshold_;
    }

    // ============================== CONFIG ==============================

    /// @notice Register (or rotate) the feed id for an asset. Owner-gated.
    function setFeed(address asset, bytes32 feedId) external onlyOwner {
        feedIdOf[asset] = feedId;
        emit FeedSet(asset, feedId);
    }

    // ============================== INGEST =============================

    /// @notice Verify a signed report for `asset` and cache the normalized reading.
    /// @dev Permissionless: the report is DON-signed, so the data cannot be forged; the only abuse is
    ///      replaying an old valid report, which the monotonic timestamp guard blocks. Non-view (drives
    ///      verify()). The adapter enforces feedId == feedIdOf[asset].
    function ingest(address asset, bytes calldata signedReport) external {
        bytes32 feedId = feedIdOf[asset];
        if (feedId == bytes32(0)) revert FeedNotSet(asset);

        OracleReading memory r = adapter.verifyAndNormalize(signedReport, feedId);

        uint256 prev = _cache[asset].timestamp;
        if (r.timestamp < prev) revert RollbackReport(prev, r.timestamp);

        _cache[asset] = r;
        _cachedAt[asset] = block.timestamp;
        emit Ingested(asset, r.price, r.timestamp, r.marketStatus);
    }

    // =============================== READ =============================

    /// @inheritdoc IOracleRouter
    function lastReading(address asset) external view returns (OracleReading memory) {
        OracleReading memory r = _cache[asset];
        if (r.timestamp == 0) revert NoReading(asset);
        return r;
    }

    /// @inheritdoc IOracleRouter
    /// @dev Applies the live gate to the cached reading and returns the EFFECTIVE status (worst-of the
    ///      cached status, the rail state, and the staleness state). Price/confidence/timestamp are
    ///      passed through unchanged — the price is never silently mutated, only its trust level.
    function getPrice(address asset) external view returns (OracleReading memory) {
        OracleReading memory r = _cache[asset];
        if (r.timestamp == 0) revert NoReading(asset);

        MarketStatus status = r.marketStatus;

        (bool up, bool withinGrace) = _sequencerState();
        if (!up || withinGrace) {
            // Rail compromised: we cannot trust freshness at all -> Degraded (worst-of with cached).
            status = status.worse(MarketStatus.Degraded);
        } else if (status == MarketStatus.Open) {
            // Rail healthy and venue says Open: a stale price means a real halt / feed outage.
            uint256 reportAge = block.timestamp - r.timestamp;
            uint256 cacheAge = block.timestamp - _cachedAt[asset];
            uint256 worstAge = reportAge > cacheAge ? reportAge : cacheAge;
            if (worstAge > stalenessThreshold) {
                status = MarketStatus.Halted;
            }
        }

        r.marketStatus = status;
        return r;
    }

    /// @dev (up, withinGrace). With no feed configured the gate is disabled (up = true, grace = false).
    ///      Mirrors the canonical Chainlink L2 pattern: answer == 0 means up; a fresh startedAt means
    ///      the sequencer only just came back and prices should not be trusted yet.
    function _sequencerState() internal view returns (bool up, bool withinGrace) {
        if (address(sequencerUptimeFeed) == address(0)) return (true, false);
        (, int256 answer, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();
        up = answer == 0;
        withinGrace = up && (block.timestamp - startedAt <= sequencerGracePeriod);
    }
}
