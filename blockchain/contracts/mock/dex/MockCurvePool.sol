// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice Minimal settable Curve pool: price_oracle() EMA (1e18) + two balances for the depth proxy.
contract MockCurvePool {
    uint256 private _priceOracle;
    uint256[2] private _balances;

    function set(uint256 priceOracle_, uint256 b0, uint256 b1) external {
        _priceOracle = priceOracle_;
        _balances[0] = b0;
        _balances[1] = b1;
    }

    function price_oracle() external view returns (uint256) {
        return _priceOracle;
    }

    function balances(uint256 i) external view returns (uint256) {
        return _balances[i];
    }
}
