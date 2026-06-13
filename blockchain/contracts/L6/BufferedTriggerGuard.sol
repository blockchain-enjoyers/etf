// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IBufferedTrigger} from "./interfaces/IBufferedTrigger.sol";

interface IHoldingsNav {
    struct NavResult {
        uint256 nav;
        uint256 confLower;
        uint256 confUpper;
        uint8 marketStatus;
        bool safe;
        uint256 timestamp;
    }
    function navOfHoldings(address vault, address[] calldata tokens, bytes[][] calldata payloads)
        external
        returns (NavResult memory);
}

interface IListingAggregator {
    function acceptedDepthOf(address asset, bytes[] calldata payloads) external returns (uint256);
}

interface IRebModule {
    function evaluate(uint256 driftBps, uint256 cardinality, bool latched, uint256 sinceRebalance)
        external
        view
        returns (bool);
    function latchCleared(uint256 driftBps) external view returns (bool);
}

interface ISequencerGuard {
    function isUp(uint256 grace) external view returns (bool);
}

interface IAuctionOpen {
    function open(
        address vault,
        address[] calldata release,
        uint256[] calldata releaseOut,
        address[] calldata acquire,
        uint256[] calldata startIn,
        uint256[] calldata endIn,
        uint64 duration
    ) external;
}

/// @notice L6 buffered-trigger guard. Decides whether a binding 24/7 weekend rebalance MAY fire, then opens
///         the L3 Dutch auction that settles it at the realized clearing price. The L4 NAV is used ONLY to
///         trigger; it is never the settlement price (iron rule). The action fires only when the live band
///         fits inside the e_max buffer that absorbs the NAV error.
contract BufferedTriggerGuard is IBufferedTrigger {
    uint256 internal constant BPS = 10_000;
    uint8 internal constant OPEN = 0; // OracleTypes.MarketStatus.Open
    uint8 internal constant CLOSED = 3; // OracleTypes.MarketStatus.Closed

    address public owner;
    IHoldingsNav public immutable nav;
    IListingAggregator public immutable aggregator;
    IRebModule public immutable rebModule;
    ISequencerGuard public immutable sequencer;
    IAuctionOpen public immutable auction;

    mapping(address => bool) public isKeeper;

    struct VaultCfg {
        bool enabled;
        bool weekend247; // act while Open too (opt-in); else only when Closed
        uint256 eMaxBps; // band-fits-buffer budget = (1/[L(1+b)]-1) in bps (R7, governance-set per vault)
        uint256 minDepth; // listing gate: min accepted depth per held token (1e18 USD)
        uint256 grace; // sequencer restart grace (seconds)
    }

    mapping(address => VaultCfg) public cfg;
    mapping(address => bool) public latched;
    mapping(address => uint256) public lastAction;

    event VaultConfigured(address indexed vault, bool weekend247, uint256 eMaxBps, uint256 minDepth, uint256 grace);
    event WeekendRebalanceOpened(address indexed vault, address indexed triggeredBy);
    event LatchCleared(address indexed vault);
    event KeeperSet(address indexed keeper, bool allowed);

    error NotOwner();
    error NotKeeper();
    error NotEnabled();
    error BandTooWide();
    error MarketNotEligible();
    error UnknownMarket();
    error SequencerDown();
    error ThinConstituent(address token);
    error NotDue();

    constructor(address nav_, address aggregator_, address rebModule_, address sequencer_, address auction_) {
        owner = msg.sender;
        nav = IHoldingsNav(nav_);
        aggregator = IListingAggregator(aggregator_);
        rebModule = IRebModule(rebModule_);
        sequencer = ISequencerGuard(sequencer_);
        auction = IAuctionOpen(auction_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyKeeper() {
        if (!isKeeper[msg.sender]) revert NotKeeper();
        _;
    }

    function setVaultCfg(address vault, bool weekend247, uint256 eMaxBps, uint256 minDepth, uint256 grace)
        external
        onlyOwner
    {
        cfg[vault] = VaultCfg({enabled: true, weekend247: weekend247, eMaxBps: eMaxBps, minDepth: minDepth, grace: grace});
        emit VaultConfigured(vault, weekend247, eMaxBps, minDepth, grace);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    /// @notice The is-due predicate + every safety gate. NON-VIEW (reads non-view nav/aggregator). Reverts with
    ///         the specific gate that failed; returns true if the action may fire.
    function checkTrigger(
        address vault,
        address[] calldata heldTokens,
        bytes[][] calldata payloads,
        uint256 driftBps,
        uint256 cardinality
    ) public returns (bool) {
        VaultCfg memory c = cfg[vault];
        if (!c.enabled) revert NotEnabled();

        _checkNavAndMarket(vault, heldTokens, payloads, c);
        _checkListingGate(heldTokens, payloads, c.minDepth);
        _checkDrift(vault, driftBps, cardinality);

        return true;
    }

    function _checkNavAndMarket(
        address vault,
        address[] calldata heldTokens,
        bytes[][] calldata payloads,
        VaultCfg memory c
    ) private {
        // 1. Band fits the buffer. The whole reason an imprecise weekend NAV is safe.
        IHoldingsNav.NavResult memory r = nav.navOfHoldings(vault, heldTokens, payloads);
        if (r.nav == 0) revert BandTooWide();
        if (r.confUpper < r.confLower) revert BandTooWide();
        uint256 band = (r.confUpper - r.confLower) / 2;
        if (band * BPS > c.eMaxBps * r.nav) revert BandTooWide();

        // 2. Market eligibility. Closed, or Open only if the vault opted into 24/7. Unknown/Halted/Degraded
        //    are degenerate readings and never eligible.
        if (r.marketStatus != OPEN && r.marketStatus != CLOSED) revert UnknownMarket();
        if (r.marketStatus == OPEN && !c.weekend247) revert MarketNotEligible();

        // 3. Sequencer up and past its restart grace.
        if (!sequencer.isUp(c.grace)) revert SequencerDown();
    }

    function _checkListingGate(
        address[] calldata heldTokens,
        bytes[][] calldata payloads,
        uint256 minDepth
    ) private {
        // 4. Listing gate: every constituent must clear the min accepted depth at its current depth.
        for (uint256 i = 0; i < heldTokens.length; ++i) {
            if (aggregator.acceptedDepthOf(heldTokens[i], payloads[i]) < minDepth) {
                revert ThinConstituent(heldTokens[i]);
            }
        }
    }

    function _checkDrift(address vault, uint256 driftBps, uint256 cardinality) private view {
        // 5. Sustained-drift Schmitt predicate (the same L3 module). The caller supplies the TWAP-derived
        //    basket drift and cardinality, exactly as the L3 keeper flow does.
        uint256 since = block.timestamp - lastAction[vault];
        if (!rebModule.evaluate(driftBps, cardinality, latched[vault], since)) revert NotDue();
    }

    struct AuctionLeg {
        address[] release;
        uint256[] releaseOut;
        address[] acquire;
        uint256[] startIn;
        uint256[] endIn;
        uint64 duration;
    }

    /// @notice Binding entrypoint: gate, then open the L3 auction. The guard must be an ALLOWLIST opener on the
    ///         auction (manager: setExecMode(vault, ALLOWLIST) + setOpenAllow(vault, guard, true)).
    /// @dev Parameters are split across two calldata structs to stay within the legacy EVM stack-slot limit.
    function openWeekendRebalance(
        address vault,
        AuctionLeg calldata leg,
        address[] calldata heldTokens,
        bytes[][] calldata payloads,
        uint256 driftBps,
        uint256 cardinality
    ) external onlyKeeper {
        checkTrigger(vault, heldTokens, payloads, driftBps, cardinality); // reverts if any gate fails
        // CEI: write state before the external auction call
        latched[vault] = true;
        lastAction[vault] = block.timestamp;
        _openAuction(vault, leg);
        emit WeekendRebalanceOpened(vault, msg.sender);
    }

    function _openAuction(address vault, AuctionLeg calldata leg) private {
        auction.open(vault, leg.release, leg.releaseOut, leg.acquire, leg.startIn, leg.endIn, leg.duration);
    }

    /// @notice Clear the latch once the TWAP-derived drift fell below the reset band (Schmitt hysteresis).
    function clearLatch(address vault, uint256 driftBps) external onlyKeeper {
        if (rebModule.latchCleared(driftBps)) {
            latched[vault] = false;
            emit LatchCleared(vault);
        }
    }
}
