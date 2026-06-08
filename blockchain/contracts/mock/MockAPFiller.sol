// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAPFiller} from "../L5/interfaces/IAPFiller.sol";

/// @notice Test AP (authorized participant) for ForwardCashQueue.settle.
///         - CREATE: the queue PULLS constituents from this contract via transferFrom, so the test just
///           pre-approves the queue for the create amounts (`approveConstituent`). The queue forwards the
///           full ticket cash here (the AP keeps its spread).
///         - REDEEM: the queue transfers the redeemed pro-rata constituents here, then calls onRedeem,
///           which pays `cashOut` (minus `shortfall`) of `stable` to the user. Set `shortfall > 0` to
///           drive the APUnderpaid revert path.
contract MockAPFiller is IAPFiller {
    using SafeERC20 for IERC20;

    IERC20 public immutable stable;
    uint256 public shortfall; // wei the AP underpays on redeem (0 = honest)

    constructor(address stable_) {
        stable = IERC20(stable_);
    }

    /// @notice Approve `queue` to pull `amount` of `token` (used for the create constituents pull).
    function approveConstituent(address token, address queue, uint256 amount) external {
        IERC20(token).approve(queue, amount);
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
