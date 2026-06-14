// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAPFiller} from "../L5/interfaces/IAPFiller.sol";

/// @dev The registry vault's ERC-6909 wrap boundary + operator authorization (RegistryCustody / ERC6909).
interface IRegistryWrap {
    function wrap(address token, uint256 amount) external;
    function setOperator(address spender, bool approved) external returns (bool);
}

/// @notice Test AP (authorized participant) for ForwardCashQueue.settle, serving BOTH vault families:
///         - MANAGED create: the queue PULLS real ERC-20 constituents via transferFrom, so the AP just
///           pre-approves the queue for the amounts (`approveConstituent`).
///         - REGISTRY create: the vault pulls the AP's ERC-6909 CLAIM slice in `settleCreate`, so the AP must
///           (a) HOLD claims — built once per vault by wrapping real ERC-20 (`wrapInventory`), and
///           (b) authorize the queue as its ERC-6909 operator (`setVaultOperator`).
///         - REDEEM (either family): the queue transfers the redeemed pro-rata constituents/claims here, then
///           calls `onRedeem`, which pays `cashOut` (minus `shortfall`) of `stable` to the recipient. Set
///           `shortfall > 0` to drive the APUnderpaid revert path.
contract MockAPFiller is IAPFiller {
    using SafeERC20 for IERC20;

    IERC20 public immutable stable;
    uint256 public shortfall; // wei the AP underpays on redeem (0 = honest)

    constructor(address stable_) {
        stable = IERC20(stable_);
    }

    /// @notice Approve `queue` to pull `amount` of `token` (used for the MANAGED create constituents pull).
    function approveConstituent(address token, address queue, uint256 amount) external {
        IERC20(token).approve(queue, amount);
    }

    /// @notice Authorize `operator` (the L5 queue) as this AP's ERC-6909 operator on a registry `vault`, so the
    ///         queue's `settleCreate` can pull this AP's vault-computed pro-rata claim slice.
    function setVaultOperator(address vault, address operator) external {
        IRegistryWrap(vault).setOperator(operator, true);
    }

    /// @notice Build registry claim inventory: pull real ERC-20 and `wrap` it into the `vault`'s ERC-6909 claims
    ///         held by THIS AP (the vault is its own per-vault ledger, so inventory is per-vault). The caller
    ///         must have funded this AP with the underlying ERC-20 first.
    function wrapInventory(address vault, address[] calldata tokens, uint256[] calldata amounts) external {
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (amounts[i] == 0) continue;
            IERC20(tokens[i]).approve(vault, amounts[i]);
            IRegistryWrap(vault).wrap(tokens[i], amounts[i]);
        }
    }

    /// @notice Make the AP underpay the redeem by `s` wei (to test APUnderpaid).
    function setShortfall(uint256 s) external {
        shortfall = s;
    }

    /// @inheritdoc IAPFiller
    function onRedeem(address[] calldata, uint256[] calldata, uint256 cashOut, address to) external override {
        // The AP keeps the constituents it just received and pays the user from its own stable balance.
        uint256 pay = cashOut > shortfall ? cashOut - shortfall : 0;
        stable.safeTransfer(to, pay);
    }
}
