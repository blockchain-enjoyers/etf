// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title KeeperModule — share-escrow that self-funds keeper rewards from the management fee
/// @notice A managed-rebalance vault mints its `keeperBps` fee-slice (basket shares) to THIS contract.
///         The escrow for a vault is simply this contract's balance of that vault's share token. This is
///         the immutable money FLOOR: it holds the escrow, trusts only a governance-registered whitelist
///         of executors (L3 RebalanceAuction, later L5 settle / L6 forced-redeem), and CLAMPS every
///         payout to min(requested, escrow, maxRewardPerCall) so the fund can never overpay. The "is it
///         due / was work done" POLICY lives in each per-flavor executor (compute->execute at the payment
///         level). Red line #3: a slice of the fee on assets, paid by the fund — never a Meridian cut,
///         never a take-rate on flow. Built once, layer-agnostic; L5/L6 reuse it.
contract KeeperModule is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice Governance-registered executors allowed to request a payout.
    mapping(address => bool) public isExecutor;
    /// @notice Hard per-call reward ceiling (in vault shares). 0 = unlimited (still clamped by escrow).
    uint256 public maxRewardPerCall;

    event ExecutorSet(address indexed executor, bool allowed);
    event MaxRewardPerCallSet(uint256 cap);
    event RewardPaid(address indexed vaultShare, address indexed to, uint256 amount);

    error NotExecutor();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Register / de-register an executor. Owner-gated.
    function setExecutor(address e, bool allowed) external onlyOwner {
        isExecutor[e] = allowed;
        emit ExecutorSet(e, allowed);
    }

    /// @notice Set the per-call reward ceiling (governance bound). Owner-gated.
    function setMaxRewardPerCall(uint256 cap) external onlyOwner {
        maxRewardPerCall = cap;
        emit MaxRewardPerCallSet(cap);
    }

    /// @notice Accrued keeper escrow for a vault = this module's balance of the vault's share token.
    function escrowOf(address vaultShare) external view returns (uint256) {
        return IERC20(vaultShare).balanceOf(address(this));
    }

    /// @notice Pay a keeper reward, CLAMPED to min(amount, escrow, maxRewardPerCall). Only a registered
    ///         executor. Returns the amount actually paid so the executor can account for the clamp.
    function pay(address vaultShare, address to, uint256 amount) external nonReentrant returns (uint256 paid) {
        if (!isExecutor[msg.sender]) revert NotExecutor();
        uint256 escrow = IERC20(vaultShare).balanceOf(address(this));
        paid = amount;
        if (paid > escrow) paid = escrow;
        if (maxRewardPerCall != 0 && paid > maxRewardPerCall) paid = maxRewardPerCall;
        if (paid > 0) {
            IERC20(vaultShare).safeTransfer(to, paid);
            emit RewardPaid(vaultShare, to, paid);
        }
    }
}
