// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title IBasketFactory
/// @notice Deploys immutable BasketVaults and stores their on-chain PCF (basket definition). [R3]
/// @dev BasketRegistry is merged in here (decision (a)). Constituent-agnostic: issuers define baskets,
///      we do not pick constituents (state.md §1). Listing-gate is applied at definition time via the guard.
interface IBasketFactory {
    event BasketCreated(bytes32 indexed basketId, address indexed vault, address basketToken);
    event BasketDefinitionFrozen(bytes32 indexed basketId);
    event ConstituentUnitQtyUpdated(bytes32 indexed basketId, address token, uint256 newUnitQty);

    error BasketExists(bytes32 basketId);
    error UnknownBasket(bytes32 basketId);
    error WeightsNot10000(uint256 sumBps);
    error DefinitionFrozen(bytes32 basketId);
    error ListingGateFailed(address constituent);

    /// @notice Deploy a new immutable vault for a basket definition. Runs the listing gate per constituent. [R7]
    function createBasket(
        MeridianTypes.Constituent[] calldata constituents,
        address cashToken,
        uint256 creationUnitSize,
        uint256 cashComponentPerUnit
    ) external returns (bytes32 basketId, address vault);

    /// @notice Freeze a basket definition (road to immutability).
    function freezeDefinition(bytes32 basketId) external;

    /// @notice Update a constituent unit quantity after a split (CORP_ACTIONS-driven). [R3 unit-math]
    function setConstituentUnitQty(bytes32 basketId, address token, uint256 newUnitQty) external;

    // -- views ---------------------------------------------------------------
    function vaultOf(bytes32 basketId) external view returns (address);
    function definitionOf(bytes32 basketId) external view returns (MeridianTypes.BasketDefinition memory);
    function constituentsOf(bytes32 basketId) external view returns (MeridianTypes.Constituent[] memory);
    function registry() external view returns (address);
}
