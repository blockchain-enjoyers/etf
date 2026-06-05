// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BasketVault} from "./BasketVault.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/// @title BasketFactory — deploys L1 static in-kind baskets (Meridian)
/// @notice The issuer calls createBasket -> an immutable BasketVault is deployed via CREATE2 with a
///         fixed recipe (PCF). On-chain enumeration via allVaults / vaultCount / getVaults so a
///         backend can list every vault without depending on event logs; provenance is stateless
///         (see predictVaultAddress).
/// @dev The CREATE2 salt is namespaced per issuer: salt = keccak256(msg.sender, userSalt). This
///      prevents front-run squatting (each issuer has its own address space) while still allowing
///      duplicate recipes (neutrality: a different userSalt or issuer yields a different vault).
///      The recipe args are part of the initcode, so the address is fully determined by
///      (issuer, userSalt, recipe); redeploying the same tuple reverts.
contract BasketFactory {
    /// @notice Every deployed vault, in deployment order. Auto-getter allVaults(i) is O(1).
    /// @dev Enumerate via vaultCount() + getVaults(start, limit) (bounded window). Never add a
    ///      function that loops over the whole array on-chain — that is the DoS antipattern.
    address[] public allVaults;

    /// @notice Emitted on every deploy with the FULL recipe so an indexer can recompute and verify
    ///         the vault address independently (do not trust the address field on reorg/backfill).
    event BasketCreated(
        address indexed vault,
        address indexed creator,
        bytes32 userSalt,
        address[] tokens,
        uint256[] unitQty,
        uint256 unitSize,
        string name,
        string symbol
    );

    /// @notice Deploy a new basket at a deterministic, issuer-namespaced CREATE2 address.
    /// @dev Recipe validation (ascending/unique tokens, non-zero qty, unitSize) is in the vault.
    /// @param tokens    basket constituents, strictly ascending by address (cash is just a token)
    /// @param unitQty   recipe per 1 creation-unit
    /// @param unitSize  basket tokens per 1 unit
    /// @param userSalt  issuer-chosen salt; final salt = keccak256(msg.sender, userSalt)
    /// @return vault    address of the deployed BasketVault (== predictVaultAddress with same args)
    function createBasket(
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        string calldata name,
        string calldata symbol,
        bytes32 userSalt
    ) external returns (address vault) {
        bytes memory initCode = _initCode(tokens, unitQty, unitSize, name, symbol);
        vault = Create2.deploy(0, _salt(msg.sender, userSalt), initCode);
        allVaults.push(vault);
        emit BasketCreated(vault, msg.sender, userSalt, tokens, unitQty, unitSize, name, symbol);
    }

    /// @notice Total number of vaults ever deployed by this factory.
    /// @return The length of the allVaults registry.
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @notice A bounded page of the registry: vaults [start, min(start+limit, count)).
    /// @dev Caller controls the window size, so this is safe at any registry size (no unbounded
    ///      return). Backend pattern: read vaultCount(), then getVaults(cursor, N) for the delta.
    /// @param start First registry index in the page.
    /// @param limit Max number of entries to return (the window is clamped to the registry end).
    /// @return page The vault addresses in [start, min(start+limit, count)).
    function getVaults(uint256 start, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 len = allVaults.length;
        if (start >= len) return new address[](0);
        uint256 end = start + limit;
        if (end > len) end = len;
        page = new address[](end - start);
        for (uint256 i = start; i < end; ++i) {
            page[i - start] = allVaults[i];
        }
    }

    /// @notice Compute the vault address for given issuer + args + userSalt WITHOUT deploying.
    /// @dev Must be called with the exact args that will be passed to createBasket, and `issuer`
    ///      = the address that will call createBasket (it is mixed into the salt).
    /// @param issuer   The address that will call createBasket (mixed into the salt).
    /// @param tokens   Basket constituents, strictly ascending by address.
    /// @param unitQty  Recipe per 1 creation-unit.
    /// @param unitSize Basket tokens per 1 unit.
    /// @param name     Basket token name.
    /// @param symbol   Basket token symbol.
    /// @param userSalt Issuer-chosen salt.
    /// @return The deterministic CREATE2 address the vault would be deployed at.
    function predictVaultAddress(
        address issuer,
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        string calldata name,
        string calldata symbol,
        bytes32 userSalt
    ) external view returns (address) {
        bytes memory initCode = _initCode(tokens, unitQty, unitSize, name, symbol);
        return Create2.computeAddress(_salt(issuer, userSalt), keccak256(initCode));
    }

    // ----------------------------------------------------------------- INTERNAL

    /// @dev Issuer-namespaced salt: prevents cross-issuer squatting on the same recipe.
    function _salt(address issuer, bytes32 userSalt) internal pure returns (bytes32) {
        return keccak256(abi.encode(issuer, userSalt));
    }

    /// @dev CREATE2 initcode = creation bytecode ++ abi-encoded constructor args.
    function _initCode(
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize,
        string calldata name,
        string calldata symbol
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                type(BasketVault).creationCode,
                abi.encode(tokens, unitQty, unitSize, name, symbol)
            );
    }
}
