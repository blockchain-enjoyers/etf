// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Settable on-chain index/proxy return (1e18-scaled, signed) read by BetaProjectionSource.
contract MockIndexReturn {
    int256 public indexReturn; // r_index, 1e18 (e.g. +0.02e18 = +2%)

    function set(int256 r) external {
        indexReturn = r;
    }
}
