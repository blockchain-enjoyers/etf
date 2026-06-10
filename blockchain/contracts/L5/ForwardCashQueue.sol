// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IAPFiller} from "./interfaces/IAPFiller.sol";
import {IRegistryVault} from "./interfaces/IRegistryVault.sol";

interface INav {
    struct NavResult { uint256 nav; uint256 confLower; uint256 confUpper; uint8 marketStatus; bool safe; uint256 timestamp; }
    function navOfHoldings(address vault, address[] calldata tokens, bytes[][] calldata payloads) external view returns (NavResult memory);
}
interface IRebVault {
    function heldTokens() external view returns (address[] memory);
    function previewCreate(uint256) external view returns (address[] memory, uint256[] memory);
    function create(uint256) external;
    function redeem(uint256) external;
}
interface IKeeperPay { function pay(address vaultShare, address to, uint256 amount) external returns (uint256); }
interface IAggregator { function isSource(address asset, address src) external view returns (bool); }
interface IObserver { function consult(address vault, uint256 window) external view returns (uint256 twap, uint256 count); }
interface IFeedRouter { function feedIdOf(address asset) external view returns (bytes32); }
interface IPegFeed { function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80); function decimals() external view returns (uint8); }

/// @title ForwardCashQueue — forward-priced cash create/redeem (ERC-7540-style) for a rebalanceable basket
/// @notice Trustless escrow (red line #1: user principal sits here across blocks but is always cancelable
///         before cutoff, settle is code-only, no team key). settle() is gated g0-g8 and reuses the vault's
///         PUBLIC create/redeem (managed vaults) or the vault's `settleCreate` primitive (registry vaults);
///         the queue is NOT a vault executor. Settle NAV = L4 FairValueNAV.navOfHoldings; the AP is paid by its
///         spread; the keeper a clamped tip from L3. The registry path is SINGLE-SHOT (Q7: ~500 internal claim
///         moves fit one tx); the chunking lives at the AP's one-time `wrap`, not the settle.
contract ForwardCashQueue is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    address public immutable vault;
    IERC20 public immutable stable;

    /// @notice True iff `vault` is a 500-native registry vault (detected by the registry-only `recipeRoot()`
    ///         selector). A registry vault routes CREATE through `vault.settleCreate` and its cash REDEEM pays
    ///         CLAIMS + deducts the vault's flatRedeemFee; a non-registry (small ManagedRebalanceVault) keeps
    ///         the legacy single-shot settle byte-for-byte.
    bool public immutable isRegistry;

    address public immutable navEngine;
    address public immutable observer;
    address public immutable keeperModule;
    address public immutable router;
    address public immutable pegFeed;

    uint64 public constant MIN_CUTOFF_DELAY = 10 minutes;
    uint64 public constant MAX_CUTOFF_DELAY = 7 days;

    uint64 public cutoffDelay = 1 hours;

    struct Ticket {
        address owner;
        bool isCreate;
        uint256 amount;
        uint64 cutoff;
        uint8 status; // 0 pending, 1 settled, 2 cancelled
    }

    Ticket[] public tickets;

    event CreateRequested(uint256 indexed id, address indexed owner, uint256 cash, uint64 cutoff);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares, uint64 cutoff);
    event Cancelled(uint256 indexed id);

    error VaultNotBootstrapped();
    error ZeroAmount();
    error NotTicketOwner();
    error PastCutoff();
    error NotPending();
    error InvalidCutoffDelay();
    error FeeTokenMismatch();

    constructor(
        address vault_,
        address stable_,
        address navEngine_,
        address observer_,
        address keeperModule_,
        address router_,
        address pegFeed_,
        address owner_
    ) Ownable(owner_) {
        vault = vault_;
        stable = IERC20(stable_);
        navEngine = navEngine_;
        observer = observer_;
        keeperModule = keeperModule_;
        router = router_;
        pegFeed = pegFeed_;

        // Impl-check the vault: a registry vault exposes recipeRoot() (RootCommitment); a ManagedRebalanceVault
        // does not, so the call reverts and is caught. For the registry path the escrow asset (stable) and the
        // vault's flat-fee asset (feeToken, USDG) MUST be identical, else the create-fee pull / redeem-fee
        // deduction would use the wrong unit — enforce it once at construction (design §D invariant).
        bool reg;
        try IRegistryVault(vault_).recipeRoot() returns (bytes32) { reg = true; } catch { reg = false; }
        if (reg && IRegistryVault(vault_).feeToken() != stable_) revert FeeTokenMismatch();
        isRegistry = reg;
    }

    function setCutoffDelay(uint64 d) external onlyOwner {
        if (d < MIN_CUTOFF_DELAY || d > MAX_CUTOFF_DELAY) revert InvalidCutoffDelay();
        cutoffDelay = d;
    }

    function ticketCount() external view returns (uint256) {
        return tickets.length;
    }

    /// @notice Queue a cash entry. Escrows `cash` USDG. Reverts if the vault is not yet bootstrapped
    ///         (cash-create never bootstraps an empty vault — first deposit is in-kind, spec section C).
    function requestCreate(uint256 cash) external nonReentrant returns (uint256 id) {
        if (cash == 0) revert ZeroAmount();
        if (IERC20(vault).totalSupply() == 0) revert VaultNotBootstrapped();
        stable.safeTransferFrom(msg.sender, address(this), cash);
        id = tickets.length;
        uint64 cutoff = uint64(block.timestamp + cutoffDelay);
        tickets.push(Ticket({owner: msg.sender, isCreate: true, amount: cash, cutoff: cutoff, status: 0}));
        emit CreateRequested(id, msg.sender, cash, cutoff);
    }

    /// @notice Queue a cash exit. Escrows `shares` of the basket token.
    function requestRedeem(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        IERC20(vault).safeTransferFrom(msg.sender, address(this), shares);
        id = tickets.length;
        uint64 cutoff = uint64(block.timestamp + cutoffDelay);
        tickets.push(Ticket({owner: msg.sender, isCreate: false, amount: shares, cutoff: cutoff, status: 0}));
        emit RedeemRequested(id, msg.sender, shares, cutoff);
    }

    /// @notice Cancel a pending ticket before its cutoff; returns the exact escrow (non-custody).
    function cancel(uint256 id) external nonReentrant {
        Ticket storage t = tickets[id];
        if (t.owner != msg.sender) revert NotTicketOwner();
        if (t.status != 0) revert NotPending();
        if (block.timestamp >= t.cutoff) revert PastCutoff();
        t.status = 2;
        if (t.isCreate) stable.safeTransfer(msg.sender, t.amount);
        else IERC20(vault).safeTransfer(msg.sender, t.amount);
        emit Cancelled(id);
    }

    // ============================== SETTLE GATE (g0-g8) ==============================

    uint256 public minNPrints;   // g6
    uint256 public twapWindow;   // g7
    uint256 public twapBandBps;  // g7
    uint256 public pegBandBps;   // g8
    uint256 public pegMaxAge;    // g8 feed-freshness
    address public aggregator;   // g1
    address public l2RouterSource; // g1
    uint256 private constant BPS = 10_000;

    error NotOpen(); error NotSafe(); error FeedNotSet(); error L2SourceMissing(); error HeldMismatch();
    error InsufficientPrints(); error TwapBandBreached(); error PegBreached(); error PegStale();

    function setGateParams(uint256 minN, uint256 win, uint256 twBps, uint256 pegBps, uint256 pegMaxAge_) external onlyOwner {
        minNPrints = minN; twapWindow = win; twapBandBps = twBps; pegBandBps = pegBps; pegMaxAge = pegMaxAge_;
    }

    function setG1Refs(address aggregator_, address l2RouterSource_) external onlyOwner {
        aggregator = aggregator_; l2RouterSource = l2RouterSource_;
    }

    /// @dev g1-g8 (g0 enforced at settle entry). Returns the struck navPerShare (1e18). The caller-supplied
    ///      `heldTokens` is VALIDATED == vault.heldTokens() and indexes both navOfHoldings and the g1 loop.
    function _settleGate(address[] calldata heldTokens, bytes[][] calldata payloads)
        internal view returns (uint256 navPerShare)
    {
        address[] memory held = IRebVault(vault).heldTokens();
        if (heldTokens.length != held.length) revert HeldMismatch();
        for (uint256 i = 0; i < held.length; ++i) {
            if (heldTokens[i] != held[i]) revert HeldMismatch();
            if (IFeedRouter(router).feedIdOf(held[i]) == bytes32(0)) revert FeedNotSet();           // g1
            if (!IAggregator(aggregator).isSource(held[i], l2RouterSource)) revert L2SourceMissing(); // g1
        }
        INav.NavResult memory r = INav(navEngine).navOfHoldings(vault, heldTokens, payloads);
        if (r.marketStatus != 0) revert NotOpen();   // g2
        if (!r.safe) revert NotSafe();                // g3 (g4 freshness handled inside navOfHoldings dropping stale survivors)
        uint256 supply = IERC20(vault).totalSupply();
        if (supply == 0) revert VaultNotBootstrapped(); // g0: named error instead of raw Panic 0x12
        navPerShare = (r.nav * 1e18) / supply;
        (uint256 twap, uint256 count) = IObserver(observer).consult(vault, twapWindow); // g6/g7
        if (count < minNPrints) revert InsufficientPrints();
        uint256 dd = navPerShare > twap ? navPerShare - twap : twap - navPerShare;
        if (dd * BPS > twapBandBps * twap) revert TwapBandBreached();
        _checkPeg(); // g8
    }

    /// @dev g8 peg gate split out so _settleGate stays under the viaIR=false stack limit.
    function _checkPeg() private view {
        (, int256 p,, uint256 updatedAt,) = IPegFeed(pegFeed).latestRoundData();
        if (block.timestamp - updatedAt > pegMaxAge) revert PegStale();
        uint256 one = 10 ** IPegFeed(pegFeed).decimals();
        uint256 pp = p > 0 ? uint256(p) : 0;
        uint256 pdiff = pp > one ? pp - one : one - pp;
        if (pdiff * BPS > pegBandBps * one) revert PegBreached();
    }

    /// @notice Test/inspection wrapper around the gate.
    function settleGateView(address[] calldata heldTokens, bytes[][] calldata payloads)
        external view returns (uint256) { return _settleGate(heldTokens, payloads); }

    // ============================== SETTLE (create+redeem) ==============================

    /// @notice 1e18 scale for the share/cash math. LOAD-BEARING: assumes an 18-decimal vault share, so
    ///         navPerShare and N (shares) are 1e18-scaled. A non-18-dec share would mis-scale create/redeem.
    uint256 private constant WAD = 1e18;

    /// @notice Hard ceiling on the fund-set AP spread: <= 2% (the R15 cap).
    uint16 public constant MAX_SPREAD_BPS = 200;
    uint16 public spreadBps;     // fund-set; AP keeps it (market spread). vault-credited deferred to IMP.
    uint256 public keeperTip;    // governance; KeeperModule clamps to escrow + maxRewardPerCall

    /// @notice Per-window CREATE-flow cap (create-gross), in BPS of the PRE-settle vault totalSupply (R15 "Capacity").
    /// @dev 0 == capacity OFF (UNLIMITED) — the default, preserving the full-fill settle byte-for-byte. When
    ///      > 0, settle caps the NEW create shares mintable in one window to `capShares = totalSupply()*bps/BPS`
    ///      (supply read ONCE before any minting). Flow beyond the cap is partially filled pro-rata and the
    ///      remainder ROLLS to the next window, staying in trustless escrow (cancelable; red line #1).
    ///      v1 caps CREATE flow ONLY (create-GROSS, no netting) — redeem-side capacity and create/redeem
    ///      NETTING are deferred to IMP. Named create-flow (not "net flow") to not over-promise netting.
    uint256 public maxCreateFlowBps;

    /// @notice Set the per-window CREATE capacity (BPS of pre-settle supply). 0 disables the cap (unlimited).
    /// @dev Reverts CapacityTooHigh if bps > BPS (a cap > 100% of supply never binds — meaningless). 0 = off.
    function setCapacity(uint256 bps) external onlyOwner {
        if (bps > BPS) revert CapacityTooHigh();
        maxCreateFlowBps = bps;
    }

    event Settled(uint256 indexed id);
    event PartialFill(uint256 indexed id, uint256 filledCash, uint256 remainingCash);
    error SpreadTooHigh(); error APUnderpaid(); error ZeroShares(); error CapacityTooHigh();

    function setSpreadBps(uint16 b) external onlyOwner { if (b > MAX_SPREAD_BPS) revert SpreadTooHigh(); spreadBps = b; }

    /// @dev The requested tip is a ceiling only: KeeperModule.pay clamps the actual payout to
    ///      min(keeperTip, escrow, maxRewardPerCall), so an over-set tip can never overpay the keeper.
    function setKeeperTip(uint256 t) external onlyOwner { keeperTip = t; }

    /// @notice Settle a batch of pending tickets at the next gated open print.
    /// @param ids        Ticket ids to attempt; each is settled only if pending (status 0) and past its
    ///                   cutoff, otherwise skipped (a skip is silent — no revert, no double-spend).
    /// @param heldTokens The vault's current custody set; VALIDATED == vault.heldTokens() by the gate and
    ///                   indexes both the NAV read and the redeem deltas.
    /// @param payloads   Per-token oracle payloads forwarded to navOfHoldings.
    /// @param ap         The authorized participant. For CREATE it must hold the constituents and (registry)
    ///                   have authorized this queue as its ERC-6909 operator, or (managed) pre-approved this
    ///                   queue to pull previewCreate(N); for REDEEM it must implement IAPFiller.onRedeem and
    ///                   pay >= cashOut. Plain address (MVP): the design spec §D `apData` is deferred.
    /// @dev GATE-ONCE-SETTLE-MANY: g0 (bootstrap) and g0-g8 (_settleGate) run ONCE up front, BEFORE any
    ///      ticket state is mutated — so a single gated open print prices the whole batch and a gate
    ///      failure reverts before any fund moves. Each per-ticket leg is atomic. The keeper tip is paid ONLY
    ///      if at least one ticket actually settled (no work -> no tip); KeeperModule then clamps the payout.
    function settle(uint256[] calldata ids, address[] calldata heldTokens, bytes[][] calldata payloads, address ap)
        external nonReentrant
    {
        uint256 supply = IERC20(vault).totalSupply();                        // read ONCE: g0 + capShares
        if (supply == 0) revert VaultNotBootstrapped();                      // g0
        uint256 navPerShare = _settleGate(heldTokens, payloads);             // g1-g8 + validates heldTokens

        // CAPACITY (R15): when maxCreateFlowBps > 0, cap the NEW create shares mintable this window to
        // capShares = pre-settle supply * maxCreateFlowBps / BPS, vs a single sum-pass of the fillable
        // create demand. capShares = type(uint256).max when the cap is OFF => the fill fraction below is
        // ALWAYS 1 and the create path is byte-for-byte the legacy full fill. Supply is read ONCE above.
        uint256 capShares = type(uint256).max;
        uint256 totalReqShares;
        if (maxCreateFlowBps > 0) {
            capShares = (supply * maxCreateFlowBps) / BPS;
            totalReqShares = _sumCreateDemand(ids, navPerShare); // pass 1 (creates only; redeems uncapped)
        }

        bool anySettled;
        for (uint256 i = 0; i < ids.length; ++i) {
            Ticket storage t = tickets[ids[i]];
            if (t.status != 0 || block.timestamp < t.cutoff) continue;       // g5 per-ticket
            if (t.isCreate) {
                // fillCash == t.amount when not over the cap (full fill); else the pro-rata scaled cash.
                uint256 fillCash = (capShares >= totalReqShares || totalReqShares == 0)
                    ? t.amount
                    : (t.amount * capShares) / totalReqShares;
                // C1: a tight cap can floor fillCash to 0 (a dust/small ticket gets a 0 slice). Settling 0
                //     would compute N==0 -> revert ZeroShares and BRICK the whole batch. Instead SKIP it
                //     (no work, anySettled stays as-is), leaving it pending to roll to a window where the
                //     cap gives it a non-zero slice. C2: refresh the cutoff so the rolled remainder stays
                //     cancelable (a capacity defer can only happen post-cutoff, else it'd be stuck forever).
                if (fillCash == 0) { t.cutoff = uint64(block.timestamp + cutoffDelay); continue; }
                // Registry vaults mint via the vault's settleCreate primitive (pull-from-AP, mint-to-user);
                // managed vaults keep the legacy real-ERC-20 previewCreate path. Same capacity/partial machinery.
                bool fully = isRegistry
                    ? _settleCreateRegistry(t, navPerShare, ap, fillCash)
                    : _settleCreate(t, navPerShare, ap, fillCash);
                if (fully) { t.status = 1; emit Settled(ids[i]); }
                else {
                    // C2: partial fill leaves the ticket pending past its old cutoff; refresh it so the user
                    //     regains a fresh cancel window on the rolled-over remainder (red line #1).
                    t.cutoff = uint64(block.timestamp + cutoffDelay);
                    // t.amount is the decremented remainder (the rolled-over amount) emitted as remainingCash.
                    emit PartialFill(ids[i], fillCash, t.amount);
                }
                anySettled = true;
            } else {
                t.status = 1;
                _settleRedeem(t, navPerShare, heldTokens, ap);
                anySettled = true;
                emit Settled(ids[i]);
            }
        }
        if (anySettled) IKeeperPay(keeperModule).pay(vault, msg.sender, keeperTip); // no work -> no tip; clamped
    }

    /// @dev Pass 1 of the capacity settle: sum the requested create shares over the FILLABLE create tickets
    ///      (status pending && past cutoff), at the struck navPerShare. Redeems are not counted (v1 caps
    ///      CREATE flow only). Extracted to keep settle() under the viaIR=false stack limit.
    function _sumCreateDemand(uint256[] calldata ids, uint256 navPerShare) private view returns (uint256 total) {
        for (uint256 i = 0; i < ids.length; ++i) {
            Ticket storage t = tickets[ids[i]];
            if (t.status != 0 || block.timestamp < t.cutoff || !t.isCreate) continue;
            uint256 netCash = (t.amount * (BPS - spreadBps)) / BPS;
            total += (netCash * WAD) / navPerShare;
        }
    }

    /// @dev Settle a MANAGED create ticket against `fillCash` (== t.amount on a full fill; a pro-rata fraction
    ///      under the cap). net-of-spread N, previewCreate(N) exact pull from the AP, vault.create, shares to the
    ///      user, fillCash to the AP. Returns whether the ticket was FULLY consumed. The full-fill path
    ///      (fillCash == t.amount) is identical to the legacy single-shot settle.
    function _settleCreate(Ticket storage t, uint256 navPerShare, address ap, uint256 fillCash)
        private returns (bool fully)
    {
        uint256 netCash = (fillCash * (BPS - spreadBps)) / BPS;
        uint256 N = (netCash * WAD) / navPerShare;
        if (N == 0) revert ZeroShares();
        (address[] memory toks, uint256[] memory amts) = IRebVault(vault).previewCreate(N);
        for (uint256 i = 0; i < toks.length; ++i) {
            IERC20(toks[i]).safeTransferFrom(ap, address(this), amts[i]); // EXACT pull; under-deliver -> revert
            IERC20(toks[i]).forceApprove(vault, amts[i]);
        }
        IRebVault(vault).create(N);                       // mints N to the queue (pulls exactly amts)
        IERC20(vault).safeTransfer(t.owner, N);           // forward shares to the user
        stable.safeTransfer(ap, fillCash);                // AP gets the filled cash (keeps spread)
        fully = (fillCash == t.amount);
        if (!fully) t.amount -= fillCash;                 // roll the remainder; ticket stays pending
    }

    /// @dev Settle a REGISTRY create against `fillCash`. The FIXED flatCreateFee comes off the top (to the
    ///      treasury, via the vault's settleCreate -> _chargeFlatCreateFee — the single collection point); the
    ///      rest (cashToAP) is the AP's fill. N = net-of-spread cashToAP / navPerShare; the vault pulls the AP's
    ///      VAULT-COMPUTED pro-rata claims and mints N to the user (single-shot — Q7: 500 claim moves fit one
    ///      tx). The AP must have authorized THIS queue as its ERC-6909 operator. Capacity/partial machinery is
    ///      shared with the managed path (fillCash is the capacity-scaled amount).
    function _settleCreateRegistry(Ticket storage t, uint256 navPerShare, address ap, uint256 fillCash)
        private returns (bool fully)
    {
        uint256 fee = IRegistryVault(vault).flatCreateFee();
        if (fillCash <= fee) revert ZeroShares();         // a fill must at least cover the fixed fee
        uint256 cashToAP = fillCash - fee;
        uint256 netCash = (cashToAP * (BPS - spreadBps)) / BPS;
        uint256 N = (netCash * WAD) / navPerShare;
        if (N == 0) revert ZeroShares();
        if (fee > 0) stable.forceApprove(vault, fee);     // settleCreate pulls the FIXED fee from the queue
        IRegistryVault(vault).settleCreate(ap, t.owner, N); // pulls AP's pro-rata claims; mints N to the user
        stable.safeTransfer(ap, cashToAP);                // AP keeps the spread (its margin, not a protocol cut)
        fully = (fillCash == t.amount);
        if (!fully) t.amount -= fillCash;                 // roll the remainder; ticket stays pending
    }

    function _settleRedeem(Ticket storage t, uint256 navPerShare, address[] calldata heldTokens, address ap) private {
        address owner_ = t.owner;
        uint256 N = t.amount;
        // net of spread; the AP's minimum payment obligation.
        uint256 cashOut = (((N * navPerShare) / WAD) * (BPS - spreadBps)) / BPS;
        if (isRegistry) {
            // A registry vault pays CLAIMS (ERC-6909), not real ERC-20, on redeem.
            uint256[] memory deltas = _redeemToAPClaims(N, heldTokens, ap);
            _payRegistryRedeem(owner_, deltas, heldTokens, cashOut, ap);  // deduct the FIXED flatRedeemFee
        } else {
            uint256[] memory deltas = _redeemToAP(N, heldTokens, ap);
            uint256 userBefore = stable.balanceOf(owner_);
            IAPFiller(ap).onRedeem(heldTokens, deltas, cashOut, owner_);  // AP MUST pay the user
            if (stable.balanceOf(owner_) - userBefore < cashOut) revert APUnderpaid();
        }
    }

    /// @dev Redeem `N` from the vault and forward the measured pro-rata delta of each held token to `ap`.
    ///      Deltas are measured pre/post burn (no estimate). Extracted to keep _settleRedeem under the
    ///      viaIR=false stack limit. Floor-dust (the sub-unit remainder redeem leaves) stays in the vault.
    function _redeemToAP(uint256 N, address[] calldata heldTokens, address ap)
        private returns (uint256[] memory deltas)
    {
        uint256 len = heldTokens.length;
        uint256[] memory balancesBefore = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) balancesBefore[i] = IERC20(heldTokens[i]).balanceOf(address(this));
        IRebVault(vault).redeem(N);                       // burns the escrowed N, sends pro-rata delta to the queue
        deltas = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            deltas[i] = IERC20(heldTokens[i]).balanceOf(address(this)) - balancesBefore[i];
            if (deltas[i] > 0) IERC20(heldTokens[i]).safeTransfer(ap, deltas[i]); // delta -> AP
        }
    }

    /// @dev Registry redeem-to-AP: burn the queue's escrowed N shares and forward the measured pro-rata CLAIM
    ///      (ERC-6909) delta of each held token to the AP. Mirrors _redeemToAP but in claims, since a registry
    ///      vault reassigns claims (not ERC-20) on redeem. Floor-dust stays in the vault for remaining holders.
    function _redeemToAPClaims(uint256 N, address[] calldata heldTokens, address ap)
        private returns (uint256[] memory deltas)
    {
        uint256 len = heldTokens.length;
        uint256[] memory balancesBefore = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) balancesBefore[i] = IRegistryVault(vault).balanceOf(address(this), _idOf(heldTokens[i]));
        IRegistryVault(vault).redeem(N);                  // burns the escrowed N, pays pro-rata CLAIMS to the queue
        deltas = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            deltas[i] = IRegistryVault(vault).balanceOf(address(this), _idOf(heldTokens[i])) - balancesBefore[i];
            if (deltas[i] > 0) IRegistryVault(vault).transfer(ap, _idOf(heldTokens[i]), deltas[i]); // claim -> AP
        }
    }

    /// @dev Registry CASH-redeem payout: the AP pays the gross `cashOut` to the QUEUE, which forwards
    ///      `cashOut - flatRedeemFee` to the redeemer and the FIXED `flatRedeemFee` to the treasury. This is
    ///      the ONLY redeem-fee collection point — in-kind redeem on the vault stays free and unconditional
    ///      (redeem never pauses). The fee is FIXED USDG, never a % of value (red line #3), and is CLAMPED to
    ///      `cashOut` so it is a deduction from proceeds, never a precondition that could block a small exit.
    function _payRegistryRedeem(
        address owner_, uint256[] memory deltas, address[] calldata heldTokens, uint256 cashOut, address ap
    ) private {
        uint256 fee = IRegistryVault(vault).flatRedeemFee();
        if (fee > cashOut) fee = cashOut;                 // clamp: never a precondition, just a deduction
        uint256 qBefore = stable.balanceOf(address(this));
        IAPFiller(ap).onRedeem(heldTokens, deltas, cashOut, address(this)); // AP pays the queue the GROSS
        if (stable.balanceOf(address(this)) - qBefore < cashOut) revert APUnderpaid();
        if (fee > 0) stable.safeTransfer(IRegistryVault(vault).treasury(), fee);
        stable.safeTransfer(owner_, cashOut - fee);
    }

    function _idOf(address token) private pure returns (uint256) { return uint256(uint160(token)); }
}
