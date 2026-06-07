// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RecipeLib} from "./core/RecipeLib.sol";
import {BasketVault} from "./BasketVault.sol";
import {ManagedVault} from "./ManagedVault.sol";
import {CommittedVault} from "./CommittedVault.sol";

/// @title CloneFactory — deploys every Meridian vault type as an EIP-1167 clone of a fixed implementation
/// @notice Holds one immutable implementation per type; each vault is a clone-with-immutable-args
///         (unitSize, recipeCommitment) initialized atomically in the same tx. Tiny (no embedded
///         creationCode) -> the 24KB factory wall is gone; new types = register an implementation.
///         Issuer-namespaced CREATE2 salt + bounded registry, as before.
contract CloneFactory is Ownable {
    address public basketImpl;
    address public managedImpl;
    address public committedImpl;

    address[] public allVaults;

    // Meridian managed-vault globals (injected into every managed clone).
    address public meridian;
    address public treasury;
    uint16 public platformShareBps;
    uint16 public constant PLATFORM_SHARE_MAX = 2000;

    error ZeroAddress();
    error ShareTooHigh();

    event BasketCreated(address indexed vault, address indexed creator, bytes32 userSalt, address[] tokens, uint256[] unitQty, uint256 unitSize, string name, string symbol);
    event ManagedBasketCreated(address indexed vault, address indexed creator, address indexed manager, uint16 managerFeeBps, bytes32 userSalt);
    event CommittedBasketCreated(address indexed vault, address indexed creator, bytes32 userSalt, address[] tokens, uint256[] unitQty, uint256 unitSize, string name, string symbol);

    constructor(address basketImpl_, address managedImpl_, address committedImpl_) Ownable(msg.sender) {
        if (basketImpl_ == address(0) || managedImpl_ == address(0) || committedImpl_ == address(0)) revert ZeroAddress();
        basketImpl = basketImpl_;
        managedImpl = managedImpl_;
        committedImpl = committedImpl_;
        meridian = msg.sender;
        treasury = msg.sender;
        platformShareBps = 1000;
    }

    function setMeridian(address a) external onlyOwner { if (a == address(0)) revert ZeroAddress(); meridian = a; }
    function setTreasury(address a) external onlyOwner { if (a == address(0)) revert ZeroAddress(); treasury = a; }
    function setPlatformShareBps(uint16 b) external onlyOwner { if (b > PLATFORM_SHARE_MAX) revert ShareTooHigh(); platformShareBps = b; }

    // -------- static (storage) --------
    function createBasket(
        address[] calldata tokens, uint256[] calldata unitQty, uint256 unitSize,
        string calldata name, string calldata symbol, bytes32 userSalt
    ) external returns (address vault) {
        bytes memory args = _args(tokens, unitQty, unitSize);
        vault = Clones.cloneDeterministicWithImmutableArgs(basketImpl, args, _salt(msg.sender, userSalt));
        BasketVault(vault).initialize(_mem(tokens), _mem2(unitQty), name, symbol);
        allVaults.push(vault);
        emit BasketCreated(vault, msg.sender, userSalt, tokens, unitQty, unitSize, name, symbol);
    }

    function predictBasketAddress(
        address issuer, address[] calldata tokens, uint256[] calldata unitQty, uint256 unitSize,
        string calldata, string calldata, bytes32 userSalt
    ) external view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(basketImpl, _args(tokens, unitQty, unitSize), _salt(issuer, userSalt), address(this));
    }

    // -------- committed --------
    function createCommittedBasket(
        address[] calldata tokens, uint256[] calldata unitQty, uint256 unitSize,
        string calldata name, string calldata symbol, bytes32 userSalt
    ) external returns (address vault) {
        bytes memory args = _args(tokens, unitQty, unitSize);
        vault = Clones.cloneDeterministicWithImmutableArgs(committedImpl, args, _salt(msg.sender, userSalt));
        CommittedVault(vault).initialize(_mem(tokens), _mem2(unitQty), name, symbol);
        allVaults.push(vault);
        emit CommittedBasketCreated(vault, msg.sender, userSalt, tokens, unitQty, unitSize, name, symbol);
    }

    function predictCommittedVaultAddress(
        address issuer, address[] calldata tokens, uint256[] calldata unitQty, uint256 unitSize,
        string calldata, string calldata, bytes32 userSalt
    ) external view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(committedImpl, _args(tokens, unitQty, unitSize), _salt(issuer, userSalt), address(this));
    }

    // -------- managed --------
    struct ManagedBasket { address[] tokens; uint256[] unitQty; uint256 unitSize; string name; string symbol; address manager; uint16 managerFeeBps; }

    function createManagedBasket(ManagedBasket calldata b, bytes32 userSalt) external returns (address vault) {
        bytes memory args = _args(b.tokens, b.unitQty, b.unitSize);
        vault = Clones.cloneDeterministicWithImmutableArgs(managedImpl, args, _salt(msg.sender, userSalt));
        ManagedVault(vault).initialize(
            _mem(b.tokens), _mem2(b.unitQty), b.name, b.symbol,
            ManagedVault.ManagedParams({manager: b.manager, meridian: meridian, treasury: treasury, managerFeeBps: b.managerFeeBps, platformShareBps: platformShareBps})
        );
        allVaults.push(vault);
        emit ManagedBasketCreated(vault, msg.sender, b.manager, b.managerFeeBps, userSalt);
    }

    function predictManagedVaultAddress(address issuer, ManagedBasket calldata b, bytes32 userSalt) external view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(managedImpl, _args(b.tokens, b.unitQty, b.unitSize), _salt(issuer, userSalt), address(this));
    }

    // -------- registry / internal --------
    function vaultCount() external view returns (uint256) { return allVaults.length; }
    function getVaults(uint256 start, uint256 limit) external view returns (address[] memory page) {
        uint256 len = allVaults.length;
        if (start >= len) return new address[](0);
        uint256 end = start + limit; if (end > len) end = len;
        page = new address[](end - start);
        for (uint256 i = start; i < end; ++i) page[i - start] = allVaults[i];
    }

    function _salt(address issuer, bytes32 userSalt) internal pure returns (bytes32) {
        return keccak256(abi.encode(issuer, userSalt));
    }
    function _args(address[] calldata tokens, uint256[] calldata unitQty, uint256 unitSize) internal pure returns (bytes memory) {
        return abi.encode(unitSize, RecipeLib.commitment(_mem(tokens), _mem2(unitQty), unitSize));
    }
    // RecipeLib.commitment takes memory; copy calldata -> memory.
    function _mem(address[] calldata a) private pure returns (address[] memory m) { m = a; }
    function _mem2(uint256[] calldata a) private pure returns (uint256[] memory m) { m = a; }
}
