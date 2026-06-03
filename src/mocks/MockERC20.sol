// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/external/IERC20.sol";

/// @title MockERC20
/// @notice Minimal, fully-implemented mintable ERC-20 with configurable decimals. Test substrate only.
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 private _decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 dec) {
        name = _name;
        symbol = _symbol;
        _decimals = dec;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Unrestricted mint — mock convenience for tests.
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Unrestricted burn — mock convenience for tests.
    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "ERC20: burn");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice xStock-style underlying (18 decimals by default).
contract MockStockToken is MockERC20 {
    constructor(string memory _name, string memory _symbol) MockERC20(_name, _symbol, 18) {}
}

/// @notice USDC-style cash leg (6 decimals) for the forward-priced queue.
contract MockUSDC is MockERC20 {
    constructor() MockERC20("Mock USD Coin", "USDC", 6) {}
}
