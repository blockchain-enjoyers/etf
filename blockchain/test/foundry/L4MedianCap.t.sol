// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {PriceAggregator} from "../../contracts/L4/PriceAggregator.sol";
import {MockSource} from "../../contracts/L4/mocks/MockSource.sol";
import {SourceKind} from "../../contracts/L4/IPriceSource.sol";
import {MarketStatus} from "../../contracts/L4/OracleTypes.sol";

/// @title L4MedianCap — manipulation-resistance moat property.
/// @notice Two honest sources cluster at 100e18 with deep depth; a single attacker source is fuzzed
///         over (price, depth). The depth-weighted median MUST stay pinned to the honest cluster within
///         the divergence band: an attacker diverging > divergenceBps is dropped by the divergence
///         filter, and one within band is by construction within band. The attacker's depth is bounded
///         below the honest depth so it can never dominate the weighted median even at the cap.
contract L4MedianCapTest is Test {
    PriceAggregator internal aggregator;
    MockSource internal honestA;
    MockSource internal honestB;
    MockSource internal attacker;

    address internal constant ASSET = address(0xA11CE);
    uint256 internal constant HONEST_PRICE = 100e18;
    uint256 internal constant HONEST_DEPTH = 1e24; // deep, well above the attacker cap

    function setUp() public {
        aggregator = new PriceAggregator(address(this));

        honestA = new MockSource();
        honestB = new MockSource();
        attacker = new MockSource();

        aggregator.addSource(ASSET, address(honestA));
        aggregator.addSource(ASSET, address(honestB));
        aggregator.addSource(ASSET, address(attacker));

        // Two honest sources: price 100e18, deep depth, fresh, healthy, not weekendAware.
        honestA.set(HONEST_PRICE, HONEST_DEPTH, uint64(block.timestamp), SourceKind.AMM_TWAP, 0, false, true);
        honestB.set(HONEST_PRICE, HONEST_DEPTH, uint64(block.timestamp), SourceKind.AMM_TWAP, 0, false, true);
    }

    /// @notice No single attacker source can move the depth-weighted median beyond the divergence band.
    function testFuzz_attackerCannotMoveMedian(uint256 attackPrice, uint256 attackDepth) public {
        attackPrice = bound(attackPrice, 1, 1_000_000e18);
        // Keep attacker depth below honest depth so it cannot dominate the weight even at the cap.
        attackDepth = bound(attackDepth, 1, 1e23);

        attacker.set(attackPrice, attackDepth, uint64(block.timestamp), SourceKind.AMM_TWAP, 0, false, true);

        bytes[] memory payloads = new bytes[](3); // MockSource ignores payloads
        PriceAggregator.AggregateResult memory r = aggregator.priceOf(ASSET, payloads);

        // The median is pinned to the honest cluster within the divergence band.
        uint256 divergenceBps = aggregator.divergenceBps();
        assertEq(divergenceBps, 200, "default divergenceBps changed");
        // 200 bps == 2% == 0.02e18 relative tolerance.
        uint256 tol = (divergenceBps * 1e18) / 10000;
        assertApproxEqRel(r.price, HONEST_PRICE, tol, "attacker moved median beyond divergence band");

        // If the result is marked safe, the survivor floor held and the band brackets the price.
        if (r.safe) {
            assertTrue(r.confUpper >= r.price && r.price >= r.confLower, "safe band does not bracket price");
            // safe implies a real market status (not Unknown).
            assertTrue(r.marketStatus != MarketStatus.Unknown, "safe with Unknown market status");
        }
    }
}
