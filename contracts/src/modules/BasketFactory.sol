// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IBufferedTriggerGuard} from "../interfaces/IBufferedTriggerGuard.sol";
import {BasketVault} from "./BasketVault.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";
import {Roles} from "../types/MeridianTypes.sol";

/// @title BasketFactory
/// @notice Deploys immutable BasketVaults and stores their on-chain PCF. BasketRegistry merged in (decision a).
/// @dev Constituent-agnostic: issuers define baskets; we do not pick constituents (state.md §1). At creation
///      it runs the listing gate per constituent via the TRIGGER_GUARD engine when one is wired. [R7]
///      IMPLEMENTED: createBasket, definition storage, views. SKELETON: split unit-math update path.
contract BasketFactory is IBasketFactory {
    IModuleRegistry public immutable _registry;
    address public immutable governor;

    bytes32[] public allBaskets;
    mapping(bytes32 => address) internal _vault;
    mapping(bytes32 => MeridianTypes.BasketDefinition) internal _def;
    mapping(bytes32 => MeridianTypes.Constituent[]) internal _constituents;

    constructor(address registry_, address _governor) {
        _registry = IModuleRegistry(registry_);
        governor = _governor;
    }

    /// @inheritdoc IBasketFactory
    function createBasket(
        MeridianTypes.Constituent[] calldata cs,
        address cashToken,
        uint256 creationUnitSize,
        uint256 cashComponentPerUnit
    ) external returns (bytes32 basketId, address vault) {
        // weights must sum to 100%
        uint256 sumBps;
        for (uint256 i = 0; i < cs.length; i++) {
            sumBps += cs[i].weightBps;
        }
        if (sumBps != 10_000) revert WeightsNot10000(sumBps);

        basketId = keccak256(abi.encode(block.chainid, allBaskets.length, cs, creationUnitSize));
        if (_vault[basketId] != address(0)) revert BasketExists(basketId);

        // Listing gate (R7) — only when a guard is wired; v1 guard is a stub that returns true.
        address guard = _registry.tryGet(Roles.TRIGGER_GUARD);
        if (guard != address(0)) {
            for (uint256 i = 0; i < cs.length; i++) {
                bool ok = IBufferedTriggerGuard(guard).checkListing(basketId, cs[i].token, cs[i].weightBps, 0);
                if (!ok) revert ListingGateFailed(cs[i].token);
            }
        }

        BasketVault v = new BasketVault(basketId, address(_registry), creationUnitSize, _toMemory(cs), "Meridian Basket", "mBASKET");
        vault = address(v);
        _vault[basketId] = vault;

        for (uint256 i = 0; i < cs.length; i++) {
            _constituents[basketId].push(cs[i]);
        }
        _def[basketId] = MeridianTypes.BasketDefinition({
            basketId: basketId,
            basketToken: vault,
            cashToken: cashToken,
            creationUnitSize: creationUnitSize,
            cashComponentPerUnit: cashComponentPerUnit,
            frozen: false
        });
        allBaskets.push(basketId);
        emit BasketCreated(basketId, vault, vault);
    }

    /// @inheritdoc IBasketFactory
    function freezeDefinition(bytes32 basketId) external {
        require(msg.sender == governor, "Factory: not governor");
        if (_vault[basketId] == address(0)) revert UnknownBasket(basketId);
        _def[basketId].frozen = true;
        emit BasketDefinitionFrozen(basketId);
    }

    /// @inheritdoc IBasketFactory
    function setConstituentUnitQty(bytes32 basketId, address token, uint256 newUnitQty) external {
        // CORP_ACTIONS-driven split unit-math. Updates the PCF mirror; the vault ledger is updated via
        // BasketVault.applySplit (skeleton). [R3]
        if (msg.sender != _registry.tryGet(Roles.CORP_ACTIONS)) revert UnknownBasket(basketId);
        if (_def[basketId].frozen) revert DefinitionFrozen(basketId);
        MeridianTypes.Constituent[] storage cs = _constituents[basketId];
        for (uint256 i = 0; i < cs.length; i++) {
            if (cs[i].token == token) {
                cs[i].unitQty = newUnitQty;
                emit ConstituentUnitQtyUpdated(basketId, token, newUnitQty);
                return;
            }
        }
        revert UnknownBasket(basketId);
    }

    // -- views ---------------------------------------------------------------

    function vaultOf(bytes32 basketId) external view returns (address) {
        return _vault[basketId];
    }

    function definitionOf(bytes32 basketId) external view returns (MeridianTypes.BasketDefinition memory) {
        return _def[basketId];
    }

    function constituentsOf(bytes32 basketId) external view returns (MeridianTypes.Constituent[] memory) {
        return _constituents[basketId];
    }

    function registry() external view returns (address) {
        return address(_registry);
    }

    function basketCount() external view returns (uint256) {
        return allBaskets.length;
    }

    function _toMemory(MeridianTypes.Constituent[] calldata cs)
        internal
        pure
        returns (MeridianTypes.Constituent[] memory out)
    {
        out = new MeridianTypes.Constituent[](cs.length);
        for (uint256 i = 0; i < cs.length; i++) {
            out[i] = cs[i];
        }
    }
}
