// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICreationRedemption} from "../interfaces/ICreationRedemption.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {IERC20} from "../interfaces/external/IERC20.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";
import {Roles} from "../types/MeridianTypes.sol";

/// @title CreationRedemption
/// @notice Forward-priced cash redemption queue (Rule 22c-1 port) + in-kind facade. [R4 §4.2]
/// @dev IMPLEMENTED: the queue structure — enqueue a cash redeem while the market is Closed (escrows the
///      basket token), cancel returns escrow. SKELETON: settleQueued (needs the next-open authoritative price
///      and cash payout rail) and the in-kind facade (v1: call BasketVault directly). IRON RULE: an estimate
///      is NEVER the settlement price; settlement waits for reopen. [R4]  [matrix #8]
contract CreationRedemption is ICreationRedemption {
    error NotImplemented();

    IBasketFactory public immutable factory;
    IModuleRegistry public immutable registry;

    mapping(bytes32 => mapping(uint256 => MeridianTypes.QueueEntry)) internal _entries;
    mapping(bytes32 => uint256) public nextNonce;

    constructor(address _factory, address _registry) {
        factory = IBasketFactory(_factory);
        registry = IModuleRegistry(_registry);
    }

    function _router() internal view returns (IOracleRouter) {
        return IOracleRouter(registry.get(Roles.ORACLE_ROUTER));
    }

    // -- in-kind facade (v1: prefer calling the vault directly) --------------

    function createInKind(bytes32, uint256, address) external pure returns (uint256) {
        // v1: in-kind create is the vault's own oracle-free path (BasketVault.mint). A facade that pulls the
        // bundle through this contract is deferred (approval-routing plumbing). [R3]
        revert NotImplemented();
    }

    function redeemInKind(bytes32, uint256, address) external pure returns (uint256) {
        revert NotImplemented();
    }

    // -- forward-priced cash queue (closed window only) ----------------------

    /// @inheritdoc ICreationRedemption
    function queueCashRedeem(bytes32 basketId, uint256 basketTokenAmount) external returns (uint256 nonce) {
        address vault = factory.vaultOf(basketId);
        require(vault != address(0), "CR: unknown basket");
        // only allowed while the market is closed; if open, the in-kind path is correct. [R4]
        MeridianTypes.MarketStatus s = _router().marketStatus(_firstConstituent(vault));
        if (s == MeridianTypes.MarketStatus.Regular) revert MarketOpenUseInKind();

        // escrow the basket tokens to be redeemed for cash at reopen
        IERC20(vault).transferFrom(msg.sender, address(this), basketTokenAmount);

        nonce = ++nextNonce[basketId];
        _entries[basketId][nonce] = MeridianTypes.QueueEntry({
            basketId: basketId,
            owner: msg.sender,
            basketTokenAmount: basketTokenAmount,
            submittedAt: uint64(block.timestamp),
            status: MeridianTypes.QueueStatus.Pending,
            nonce: nonce
        });
        emit CashRedeemQueued(basketId, msg.sender, nonce, basketTokenAmount);
    }

    /// @inheritdoc ICreationRedemption
    function settleQueued(bytes32 basketId, uint256 nonce) external returns (uint256) {
        MeridianTypes.QueueEntry storage e = _entries[basketId][nonce];
        if (e.status != MeridianTypes.QueueStatus.Pending) revert UnknownEntry(nonce);
        address vault = factory.vaultOf(basketId);
        MeridianTypes.MarketStatus s = _router().marketStatus(_firstConstituent(vault));
        if (s != MeridianTypes.MarketStatus.Regular) revert MarketStillClosed();
        // TODO: price the redemption at the next-open AUTHORITATIVE NAV (never an estimate), pay cashToken out
        //       and burn the escrowed basket tokens. Requires the cash settlement rail + redemption counterparty
        //       (Dinari/Ondo). [R4]  This is the iron-rule boundary.
        revert NotImplemented();
    }

    /// @inheritdoc ICreationRedemption
    function cancelQueued(bytes32 basketId, uint256 nonce) external {
        MeridianTypes.QueueEntry storage e = _entries[basketId][nonce];
        if (e.status != MeridianTypes.QueueStatus.Pending) revert UnknownEntry(nonce);
        require(msg.sender == e.owner, "CR: not owner");
        e.status = MeridianTypes.QueueStatus.Cancelled;
        address vault = factory.vaultOf(basketId);
        IERC20(vault).transfer(e.owner, e.basketTokenAmount); // return escrow
        emit CashRedeemCancelled(basketId, nonce);
    }

    function entry(bytes32 basketId, uint256 nonce) external view returns (MeridianTypes.QueueEntry memory) {
        return _entries[basketId][nonce];
    }

    function _firstConstituent(address vault) internal view returns (address) {
        return IBasketVault(vault).constituents()[0].token;
    }
}
