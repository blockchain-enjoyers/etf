// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICorporateActions} from "../interfaces/ICorporateActions.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {MockCorporateActions} from "../mocks/MockCorporateActions.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title CorporateActionsModule
/// @notice Splits + dividends. BLOCKED on real data in v1 (unshipped RH APIs, §10) -> reads a mock source. [R3/R5]
/// @dev SKELETON: reads/classifies the action from the (mock) source; the APPLICATION path is deferred because
///      it needs the vault ledger design (which token a split scales) and a cash-escrow design for dividends
///      (open question #1). Application reverts NotImplemented until that is settled. [matrix #4,5]
contract CorporateActionsModule is ICorporateActions {
    error NotImplemented();

    IBasketFactory public immutable factory;
    IModuleRegistry public immutable registry;
    MockCorporateActions public source; // swapped for a real Chainlink Tokenized Asset v10 feed in v2

    mapping(bytes32 => mapping(uint64 => bool)) public processed; // (basketId, eventDate) dedup
    mapping(bytes32 => uint256) public accDividendPerShare; // accumulator for the mock dividend path

    constructor(address _factory, address _registry, address _source) {
        factory = IBasketFactory(_factory);
        registry = IModuleRegistry(_registry);
        source = MockCorporateActions(_source);
    }

    /// @inheritdoc ICorporateActions
    function processAction(bytes32 basketId, address token) external {
        MeridianTypes.CorpAction memory a = source.latestAction(basketId, token);
        if (a.actionType == MeridianTypes.CorpActionType.None) revert UnsupportedAction(a.actionType);
        if (processed[basketId][a.eventDate]) revert ActionAlreadyProcessed(basketId, a.eventDate);
        _apply(basketId, token, a);
    }

    /// @inheritdoc ICorporateActions
    function applyAction(bytes32 basketId, address token, MeridianTypes.CorpAction calldata action) external {
        if (processed[basketId][action.eventDate]) revert ActionAlreadyProcessed(basketId, action.eventDate);
        _apply(basketId, token, action);
    }

    function _apply(bytes32 basketId, address token, MeridianTypes.CorpAction memory a) internal {
        processed[basketId][a.eventDate] = true;
        if (a.actionType == MeridianTypes.CorpActionType.Split) {
            emit SplitProcessed(basketId, token, a.splitRatioNum, a.splitRatioDen);
            // TODO: factory.setConstituentUnitQty(basketId, token, newQty) + vault.applySplit(...). Needs the
            //       per-constituent ledger semantics in BasketVault (open Q#1, vault.applySplit is skeleton). [R3]
            revert NotImplemented();
        } else if (a.actionType == MeridianTypes.CorpActionType.Dividend) {
            emit DividendProcessed(basketId, token, a.dividendPerShare, a.reinvest);
            // TODO: route cash into a per-share claims ledger (payout) or buy-and-mint (reinvest). Needs cash
            //       escrow design (open Q#1). vault.accrueDividend(...) is skeleton. [R3]
            revert NotImplemented();
        }
        revert UnsupportedAction(a.actionType);
    }

    /// @inheritdoc ICorporateActions
    function claimableDividend(bytes32 basketId, address holder) external view returns (uint256) {
        // Shape of the intended computation: holderShare = basketToken.balanceOf(holder) * accPerShare / 1e18.
        address vault = factory.vaultOf(basketId);
        if (vault == address(0)) return 0;
        return (IBasketVault(vault).holdingOf(holder) * accDividendPerShare[basketId]) / 1e18; // placeholder
    }

    /// @inheritdoc ICorporateActions
    function claim(bytes32) external pure returns (uint256) {
        // TODO: transfer accrued cash from escrow; depends on dividend funding design (open Q#1).
        revert NotImplemented();
    }
}
