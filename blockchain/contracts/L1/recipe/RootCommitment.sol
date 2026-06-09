// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title RootCommitment — mutable, timelocked Merkle composition root with data-availability events
/// @notice For the 500-native vault, the recipe is anchored by a Merkle root (MerkleRecipeLib) that the curator
///         can rotate (reconstitution) behind a 7-day timelock — holders see the pending root and may exit
///         before it applies (redeem never pauses). Every schedule emits the FULL recipe so it is always
///         reconstructable from logs even if an operator backend disappears (a root alone is not data-available).
///         The emitted recipe is NOT verified on-chain against the root (an on-chain 500-leaf tree rebuild is
///         avoided): holdings-based redeem is the enforcement backstop (a bad/stale root cannot strand holders,
///         who are paid what is actually held), and off-chain watchers verify tree(recipe)==root and alarm.
abstract contract RootCommitment is Initializable {
    uint256 public constant ROOT_TIMELOCK = 7 days;

    /// @notice The live composition Merkle root.
    bytes32 public recipeRoot;
    /// @notice A scheduled-but-not-yet-active root (bytes32(0) when none).
    bytes32 public pendingRoot;
    /// @notice When `pendingRoot` may be activated (0 when none scheduled).
    uint64 public rootEffectiveAt;

    event RootScheduled(bytes32 indexed newRoot, uint64 effectiveAt, address[] tokens, uint256[] unitQty, uint256 unitSize);
    event RootActivated(bytes32 indexed newRoot);

    error NotRootCurator();
    error NoPendingRoot();
    error RootTimelockNotElapsed();
    error ZeroRoot();

    function __RootCommitment_init(bytes32 genesisRoot) internal onlyInitializing {
        recipeRoot = genesisRoot;
    }

    /// @dev The leaf restricts who may rotate the root (e.g. onlyManager). Must revert NotRootCurator otherwise.
    function _requireRootCurator() internal view virtual;

    /// @notice Schedule a new composition root; emits the FULL recipe for data availability. Applies after
    ///         ROOT_TIMELOCK via activateRoot. Re-calling overwrites the pending root and resets the timelock.
    ///         The zero root is rejected: a zero live root would be indistinguishable from "unset".
    function scheduleRoot(
        bytes32 newRoot,
        address[] calldata tokens,
        uint256[] calldata unitQty,
        uint256 unitSize
    ) external {
        _requireRootCurator();
        if (newRoot == bytes32(0)) revert ZeroRoot();
        pendingRoot = newRoot;
        rootEffectiveAt = uint64(block.timestamp + ROOT_TIMELOCK);
        emit RootScheduled(newRoot, rootEffectiveAt, tokens, unitQty, unitSize);
    }

    /// @notice Apply the scheduled root after its timelock. Reverts NoPendingRoot / RootTimelockNotElapsed.
    function activateRoot() external {
        _requireRootCurator();
        uint64 eff = rootEffectiveAt;
        if (eff == 0) revert NoPendingRoot();
        if (block.timestamp < eff) revert RootTimelockNotElapsed();
        recipeRoot = pendingRoot;
        pendingRoot = bytes32(0);
        rootEffectiveAt = 0;
        emit RootActivated(recipeRoot);
    }
}
