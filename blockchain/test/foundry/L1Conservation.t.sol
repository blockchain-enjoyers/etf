// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {MockERC20Decimals} from "../../contracts/mock/MockERC20Decimals.sol";
import {BasketVault} from "../../contracts/L1/BasketVault.sol";
import {ManagedVault} from "../../contracts/L1/ManagedVault.sol";
import {CommittedVault} from "../../contracts/L1/CommittedVault.sol";
import {CloneFactory} from "../../contracts/L1/CloneFactory.sol";

/// @dev Fuzzed actor that drives create/redeem on a single BasketVault. The invariant suite
///      targets this handler, so every fuzz sequence is a series of valid create/redeem calls.
contract Handler is Test {
    BasketVault public vault;
    MockERC20Decimals public t0;
    MockERC20Decimals public t1;
    uint256 public q0;
    uint256 public q1;

    constructor(BasketVault _vault, MockERC20Decimals _t0, MockERC20Decimals _t1, uint256 _q0, uint256 _q1) {
        vault = _vault;
        t0 = _t0;
        t1 = _t1;
        q0 = _q0;
        q1 = _q1;
    }

    function create(uint256 nUnits) external {
        nUnits = bound(nUnits, 1, 1e6);
        // Mint exactly the recipe amount of each constituent to this handler, approve, create.
        t0.mint(address(this), q0 * nUnits);
        t1.mint(address(this), q1 * nUnits);
        t0.approve(address(vault), q0 * nUnits);
        t1.approve(address(vault), q1 * nUnits);
        vault.create(nUnits);
    }

    function redeem(uint256 amount) external {
        uint256 bal = vault.balanceOf(address(this));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vault.redeem(amount);
    }
}

/// @title L1Conservation — invariant: a BasketVault is NEVER under-collateralized.
/// @notice For every constituent i, the vault's real balance must back at least the
///         proportional claim of the outstanding supply:
///             balance_i >= unitQty_i * totalSupply / unitSize
///         create deposits exact proportions; redeem floors the pro-rata payout, leaving dust IN
///         the vault. So the vault is always at least proportionally backed (>=, not ==).
contract L1ConservationTest is Test {
    BasketVault internal vault;
    MockERC20Decimals internal t0;
    MockERC20Decimals internal t1;
    Handler internal handler;

    uint256 internal q0 = 2e18;
    uint256 internal q1 = 3e18;
    uint256 internal unitSize = 1e18;

    function setUp() public {
        // Two 18-dec constituents, sorted so token0 < token1 (recipe requires strictly-ascending addrs).
        MockERC20Decimals a = new MockERC20Decimals("Token A", "TKA", 18);
        MockERC20Decimals b = new MockERC20Decimals("Token B", "TKB", 18);
        if (address(a) < address(b)) {
            t0 = a;
            t1 = b;
        } else {
            t0 = b;
            t1 = a;
        }

        // Deploy the three clone implementations, then the factory.
        BasketVault basketImpl = new BasketVault();
        ManagedVault managedImpl = new ManagedVault();
        CommittedVault committedImpl = new CommittedVault();
        CloneFactory factory = new CloneFactory(address(basketImpl), address(managedImpl), address(committedImpl));

        address[] memory tokens = new address[](2);
        tokens[0] = address(t0);
        tokens[1] = address(t1);
        uint256[] memory unitQty = new uint256[](2);
        unitQty[0] = q0;
        unitQty[1] = q1;

        address v = factory.createBasket(tokens, unitQty, unitSize, "Basket", "BSKT", bytes32(0));
        vault = BasketVault(v);

        handler = new Handler(vault, t0, t1, q0, q1);
        targetContract(address(handler));
    }

    /// @notice The core conservation property: never under-collateralized on any constituent.
    function invariant_neverUnderCollateralized() public view {
        uint256 supply = vault.totalSupply();
        assertGe(t0.balanceOf(address(vault)), (q0 * supply) / unitSize, "t0 under-collateralized");
        assertGe(t1.balanceOf(address(vault)), (q1 * supply) / unitSize, "t1 under-collateralized");
    }
}
