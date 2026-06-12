// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Stock} from "../../contracts/mock/stock/Stock.sol";
import {StockProxy} from "../../contracts/mock/stock/StockProxy.sol";
import {AccessControlsRegistry} from "../../contracts/mock/stock/AccessControlsRegistry.sol";

/// @title StockFaucetMint — the open, capped, fixed-amount mint built into the Stock mock.
/// @notice Anyone can call faucetMint() once for a fixed 100e18 (FAUCET_CAP == FAUCET_AMOUNT, so the
///         second call from the same address reverts). The role-gated mint(to, amount) is unchanged.
contract StockFaucetMintTest is Test {
    Stock internal stock;
    AccessControlsRegistry internal registry;

    address internal admin = address(0xA11CE);
    address internal alice = address(0xBEEF);
    address internal bob = address(0xCAFE);

    function setUp() public {
        registry = new AccessControlsRegistry(admin);
        Stock impl = new Stock(address(registry));
        bytes memory initData =
            abi.encodeWithSelector(Stock.initialize.selector, bytes32("AAPL"), "Apple", "AAPL");
        StockProxy proxy = new StockProxy(address(impl), initData);
        stock = Stock(address(proxy));
    }

    function testFaucetMintGivesFixedAmount() public {
        vm.prank(alice);
        stock.faucetMint();
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(stock.faucetMinted(alice), 100e18);
    }

    function testSecondFaucetMintRevertsPastCap() public {
        vm.prank(alice);
        stock.faucetMint();
        vm.prank(alice);
        vm.expectRevert(Stock.FaucetCapExceeded.selector);
        stock.faucetMint();
    }

    function testFaucetCapsArePerAddress() public {
        vm.prank(alice);
        stock.faucetMint();
        vm.prank(bob);
        stock.faucetMint();
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(stock.balanceOf(bob), 100e18);
        assertEq(stock.faucetMinted(alice), 100e18);
        assertEq(stock.faucetMinted(bob), 100e18);
    }

    function testRoleGatedMintStillRevertsForNonMinter() public {
        vm.prank(alice);
        vm.expectRevert();
        stock.mint(alice, 1e18);
    }
}
