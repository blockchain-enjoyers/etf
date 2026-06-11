// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {MockERC20Decimals} from "../../contracts/mock/MockERC20Decimals.sol";
import {RegistryCustodyHarness} from "../../contracts/mock/registry/RegistryCustodyHarness.sol";

/// @dev The ONLY actor. wrap mints ERC-6909 claims to itself; unwrap burns them and returns real ERC-20.
///      It also exercises the internal custody port: custodyIn moves the handler's own claims into the
///      vault's self-custody, custodyOut moves them back. So all outstanding claims live in exactly two
///      holders: the handler and the harness itself.
contract Handler is Test {
    MockERC20Decimals public token;
    RegistryCustodyHarness public harness;

    constructor(MockERC20Decimals _token, RegistryCustodyHarness _harness) {
        token = _token;
        harness = _harness;
    }

    function _id() internal view returns (uint256) {
        return harness.idOf(address(token));
    }

    /// Mint real ERC-20 to self, approve, wrap into ERC-6909 claims.
    function wrap(uint256 amt) external {
        amt = bound(amt, 1, 1e24);
        token.mint(address(this), amt);
        token.approve(address(harness), amt);
        harness.wrap(address(token), amt);
    }

    /// Burn up to the handler's current claim balance, sending real ERC-20 back to self.
    function unwrap(uint256 amt) external {
        uint256 bal = harness.balanceOf(address(this), _id());
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        harness.unwrap(address(token), amt, address(this));
    }

    /// Move some of the handler's own claims into the vault's self-custody (internal reassignment).
    function custodyIn(uint256 amt) external {
        uint256 bal = harness.balanceOf(address(this), _id());
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        harness.custodyIn(address(this), address(token), amt);
    }

    /// Move some of the vault's self-custody claims back to the handler.
    function custodyOut(uint256 amt) external {
        uint256 bal = harness.balanceOf(address(harness), _id());
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        harness.custodyOut(address(this), address(token), amt);
    }
}

/// @title L3ClaimConservation — invariant: ERC-6909 claims are always fully backed by real ERC-20.
/// @notice For the wrapped token, the real ERC-20 sitting in the vault must equal the total outstanding
///         ERC-6909 claims of that id across all holders. wrap is the only mint (1:1 with a real deposit),
///         unwrap the only burn (1:1 with a real withdrawal); custodyIn/custodyOut are pure internal
///         reassignments that conserve the total. So real backing == total claims, exactly (==, not >=).
contract L3ClaimConservationTest is Test {
    MockERC20Decimals internal token;
    RegistryCustodyHarness internal harness;
    Handler internal handler;

    function setUp() public {
        token = new MockERC20Decimals("Constituent", "CON", 18);
        harness = new RegistryCustodyHarness();
        harness.initialize();

        handler = new Handler(token, harness);
        targetContract(address(handler));
    }

    /// @notice Real ERC-20 held by the vault == sum of all outstanding ERC-6909 claims of this id.
    function invariant_claimsFullyBacked() public view {
        uint256 id = harness.idOf(address(token));
        uint256 totalClaims =
            harness.balanceOf(address(handler), id) + harness.balanceOf(address(harness), id);
        assertEq(
            token.balanceOf(address(harness)),
            totalClaims,
            "ERC-6909 claims not fully backed by real ERC-20"
        );
    }
}
