// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title ICreationRedemption
/// @notice Two settlement rails: (1) in-kind via the vault (oracle-free), (2) forward-priced cash queue
///         that settles at the next market open's authoritative price. [R4 §4.2 Rule 22c-1 port]
/// @dev IRON RULE: a closed-market estimate is NEVER the settlement price. Cash flows submitted while the
///      market is closed wait and settle at reopen. In-kind path stays open unconditionally. [R4]
interface ICreationRedemption {
    event InKindCreated(bytes32 indexed basketId, address indexed who, uint256 units);
    event InKindRedeemed(bytes32 indexed basketId, address indexed who, uint256 units);
    event CashRedeemQueued(bytes32 indexed basketId, address indexed who, uint256 nonce, uint256 amount);
    event CashRedeemSettled(bytes32 indexed basketId, uint256 nonce, uint256 cashOut, uint256 settlementPrice);
    event CashRedeemCancelled(bytes32 indexed basketId, uint256 nonce);

    error MarketOpenUseInKind();
    error MarketStillClosed();
    error UnknownEntry(uint256 nonce);
    error AlreadySettled(uint256 nonce);
    error DuplicateNonce(uint256 nonce);

    // -- in-kind (delegates to vault, oracle-free) ---------------------------
    function createInKind(bytes32 basketId, uint256 units, address to) external returns (uint256 amount);
    function redeemInKind(bytes32 basketId, uint256 basketTokenAmount, address to) external returns (uint256 units);

    // -- forward-priced cash queue (closed window only) ----------------------

    /// @notice Queue a cash-denominated redemption while the market is closed. [R4]
    function queueCashRedeem(bytes32 basketId, uint256 basketTokenAmount) external returns (uint256 nonce);

    /// @notice Settle a queued entry once the market reopens, at the next-open authoritative price.
    /// @dev Permissionless keeper call. Reverts if still closed. Estimate is never used here. [R4]
    function settleQueued(bytes32 basketId, uint256 nonce) external returns (uint256 cashOut);

    function cancelQueued(bytes32 basketId, uint256 nonce) external;

    function entry(bytes32 basketId, uint256 nonce) external view returns (MeridianTypes.QueueEntry memory);
}
