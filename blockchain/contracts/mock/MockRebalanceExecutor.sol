// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRebalanceExecutor} from "../L3/IRebalanceExecutor.sol";

interface IRebalanceVault {
    function executeRebalance(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address recipient
    ) external;
}

/// @notice Test stand-in for the Part-3 auction: pulls the bidder's acquire tokens, approves the vault,
///         and calls executeRebalance. The vault does the atomic swap + gating.
contract MockRebalanceExecutor is IRebalanceExecutor {
    using SafeERC20 for IERC20;
    address public immutable vault;
    constructor(address v) { vault = v; }

    function bidSwap(
        address[] calldata acquire, uint256[] calldata acquireIn,
        address[] calldata release, uint256[] calldata releaseOut,
        uint256[] calldata minOut, address bidder
    ) external returns (uint256[] memory) {
        _pullAndApprove(acquire, acquireIn, bidder);
        IRebalanceVault(vault).executeRebalance(acquire, acquireIn, release, releaseOut, minOut, bidder);
        return new uint256[](acquire.length);
    }

    function _pullAndApprove(address[] calldata acquire, uint256[] calldata acquireIn, address bidder) internal {
        for (uint256 i = 0; i < acquire.length; ++i) {
            IERC20(acquire[i]).safeTransferFrom(bidder, address(this), acquireIn[i]);
            IERC20(acquire[i]).forceApprove(vault, acquireIn[i]);
        }
    }
}
