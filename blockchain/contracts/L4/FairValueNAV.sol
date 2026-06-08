// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {PriceAggregator} from "./PriceAggregator.sol";
import {IRecipeVault} from "./interfaces/IRecipeVault.sol";
import {MarketStatus, MarketStatusLib} from "./OracleTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
            uint256 bal = IERC20(tokens[i]).balanceOf(vault);
            res.nav += (bal * a.price) / 1e18;
            res.confLower += (bal * a.confLower) / 1e18;
            res.confUpper += (bal * a.confUpper) / 1e18;
            res.marketStatus = res.marketStatus.worse(a.marketStatus);
            if (!a.safe) res.safe = false;
            if (a.timestamp < res.timestamp) res.timestamp = a.timestamp;
        }
        if (n == 0) res.timestamp = 0;
    }
}
