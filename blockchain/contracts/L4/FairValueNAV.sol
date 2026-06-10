// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {PriceAggregator} from "./PriceAggregator.sol";
import {IRecipeVault} from "./interfaces/IRecipeVault.sol";
import {IPriceSource, SourceReading} from "./IPriceSource.sol";
import {MarketStatus, MarketStatusLib} from "./OracleTypes.sol";

/// @notice Polymorphic vault-side holdings seam (F2): the vault reports its OWN holding of a constituent.
///         Managed/static vaults return IERC20(token).balanceOf(self); a registry vault returns its ERC-6909
///         claim backing. Reading this (not the raw ERC20 balance) keeps a registry vault from counting
///         every AP's staged ERC20 inventory in NAV.
interface IHoldings { function holdingsOf(address token) external view returns (uint256); }

/// @title FairValueNAV — read-only basket NAV over the L4 aggregator
/// @notice Validates the calldata recipe against vault.recipeCommitment() (the only L1<->L4 seam, same
///         keccak256(abi.encode(tokens, unitQty, unitSize)) as CommitmentNAV), then sums the aggregated
///         per-constituent price: nav = sum(unitQty_i * price_i). Read-only: settles nothing; the
///         estimate (safe, band) feeds risk/info only, never settlement (iron rule). Basket safe = AND
///         over constituents; status = worst-of; timestamp = oldest.
contract FairValueNAV {
    using MarketStatusLib for MarketStatus;

    PriceAggregator public immutable aggregator;

    error RecipeMismatch();
    error LengthMismatch();

    struct NavResult {
        uint256 nav;
        uint256 confLower;
        uint256 confUpper;
        MarketStatus marketStatus;
        bool safe;
        uint256 timestamp;
    }

    constructor(PriceAggregator aggregator_) {
        aggregator = aggregator_;
    }

    function navOf(
        address vault,
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        bytes[][] calldata payloads
    ) external returns (NavResult memory res) {
        if (keccak256(abi.encode(tokens, unitQty, unitSize)) != IRecipeVault(vault).recipeCommitment()) {
            revert RecipeMismatch();
        }
        uint256 n = tokens.length;
        if (unitQty.length != n || payloads.length != n) revert LengthMismatch();

        res.marketStatus = MarketStatus.Open;
        res.timestamp = type(uint256).max;
        res.safe = true;

        for (uint256 i = 0; i < n; ++i) {
            PriceAggregator.AggregateResult memory a = aggregator.priceOf(tokens[i], payloads[i]);
            res.nav += (unitQty[i] * a.price) / 1e18;
            res.confLower += (unitQty[i] * a.confLower) / 1e18;
            res.confUpper += (unitQty[i] * a.confUpper) / 1e18;
            res.marketStatus = res.marketStatus.worse(a.marketStatus);
            if (!a.safe) res.safe = false;
            if (a.timestamp < res.timestamp) res.timestamp = a.timestamp;
        }
        if (n == 0) res.timestamp = 0;
    }

    /// @notice Like navOf, plus a cross-check against direct whole-basket sources registered under the
    ///         vault address. If sum-of-parts and the direct basket price diverge beyond the
    ///         aggregator's divergenceBps, the basket is flagged unsafe (ETF premium/discount signal).
    /// @param basketPayloads payloads for the vault-keyed direct basket sources.
    function navWithBasketCheck(
        address vault,
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        bytes[][] calldata payloads,
        bytes[] calldata basketPayloads
    ) external returns (NavResult memory res) {
        res = this.navOf(vault, tokens, unitQty, unitSize, payloads);

        if (aggregator.sourceCount(vault) == 0) return res; // no direct source: sum-of-parts only

        PriceAggregator.AggregateResult memory direct = aggregator.priceOf(vault, basketPayloads);
        if (!direct.safe) { res.safe = false; return res; }

        uint256 sop = res.nav;
        uint256 diff = sop > direct.price ? sop - direct.price : direct.price - sop;
        if (diff * 10000 > aggregator.divergenceBps() * sop) {
            res.safe = false;
        }
    }

    /// @notice Holdings-based NAV: value the vault's ACTUAL balances over the supplied token set (the
    ///         vault's heldTokens()), aggregating each price. For rebalanceable vaults whose holdings
    ///         differ from any committed recipe mid-rebalance. Estimate only (iron rule).
    function navOfHoldings(address vault, address[] calldata tokens, bytes[][] calldata payloads)
        external returns (NavResult memory res)
    {
        uint256 n = tokens.length;
        if (payloads.length != n) revert LengthMismatch();
        res.marketStatus = MarketStatus.Open;
        res.timestamp = type(uint256).max;
        res.safe = true;
        for (uint256 i = 0; i < n; ++i) {
            PriceAggregator.AggregateResult memory a = aggregator.priceOf(tokens[i], payloads[i]);
            uint256 bal = IHoldings(vault).holdingsOf(tokens[i]);
            res.nav += (bal * a.price) / 1e18;
            res.confLower += (bal * a.confLower) / 1e18;
            res.confUpper += (bal * a.confUpper) / 1e18;
            res.marketStatus = res.marketStatus.worse(a.marketStatus);
            if (!a.safe) res.safe = false;
            if (a.timestamp < res.timestamp) res.timestamp = a.timestamp;
        }
        if (n == 0) res.timestamp = 0;
    }

    /// @notice Holdings NAV plus a beta-projection cross-check (the EP-3 veto). Computes the on-chain
    ///         holdings aggregate AND a fund-attested beta-projection NAV (Σ balance_i · P̂_i from
    ///         `betaSource`); if they diverge by more than `betaDivergenceBps`, flips `safe=false`. The beta
    ///         source is consumed HERE as a veto, never registered in the aggregator's depth-weighted median
    ///         (a low-depth source would just be ignored). Estimate only (iron rule): settles nothing.
    /// @param betaSource     a BetaProjectionSource (IPriceSource); read per-constituent.
    /// @param betaPayloads   per-constituent signed beta payloads, aligned to `tokens`.
    /// @param betaDivergenceBps allowed |holdings − projection| / holdings before the basket is flagged.
    function navWithBetaCheck(
        address vault,
        address[] calldata tokens,
        bytes[][] calldata payloads,
        address betaSource,
        bytes[] calldata betaPayloads,
        uint256 betaDivergenceBps
    ) external returns (NavResult memory res) {
        res = this.navOfHoldings(vault, tokens, payloads);
        if (betaPayloads.length != tokens.length) revert LengthMismatch();
        if (res.nav == 0) return res;

        uint256 betaNav = _betaNav(vault, tokens, betaSource, betaPayloads);
        uint256 diff = res.nav > betaNav ? res.nav - betaNav : betaNav - res.nav;
        if (diff * 10000 > betaDivergenceBps * res.nav) res.safe = false;
    }

    /// @dev Σ balance_i · P̂_i over the beta source (split out to keep navWithBetaCheck within the legacy
    ///      codegen stack-slot limit — viaIR stays false).
    function _betaNav(address vault, address[] calldata tokens, address betaSource, bytes[] calldata betaPayloads)
        internal
        returns (uint256 betaNav)
    {
        for (uint256 i = 0; i < tokens.length; ++i) {
            SourceReading memory b = IPriceSource(betaSource).read(betaPayloads[i]);
            betaNav += (IHoldings(vault).holdingsOf(tokens[i]) * b.price) / 1e18;
        }
    }
}
