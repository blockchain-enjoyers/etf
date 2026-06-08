// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IAPFiller {
    /// @notice Cash-redeem callback: the AP has just received `amts[i]` of `toks[i]` from the queue and
    ///         MUST pay `cashOut` stablecoin to `to`. The queue verifies the payment (reverts if underpaid).
    function onRedeem(address[] calldata toks, uint256[] calldata amts, uint256 cashOut, address to) external;
}
