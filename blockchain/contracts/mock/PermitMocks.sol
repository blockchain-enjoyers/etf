// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test-only constituents exercising the createWithPermit edge paths.

/// @title PlainERC20 — standard ERC20 with NO permit() (exercises the "constituent lacks permit" path).
contract PlainERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title NoopPermitERC20 — permit() succeeds but sets NO allowance (a griefing token).
/// @dev With the vault's post-permit allowance check this must surface as PermitFailed.
contract NoopPermitERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external {}
}

/// @title ReentrantPermitERC20 — permit() reenters the vault's create() to probe the reentrancy guard.
/// @dev `arm` gives this token a self-balance + max approval to the vault so the reentrant create()
///      would SUCCEED if not for the guard; lastReentryOk records whether it did. permit() also sets
///      the caller's allowance so the OUTER createWithPermit proceeds normally.
contract ReentrantPermitERC20 is ERC20 {
    address public target;
    bool public lastReentryOk;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address vault, uint256 selfBalance) external {
        target = vault;
        _mint(address(this), selfBalance);
        _approve(address(this), vault, type(uint256).max);
    }

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32)
        external
    {
        if (target != address(0)) {
            (bool ok, ) = target.call(abi.encodeWithSignature("create(uint256)", uint256(1)));
            lastReentryOk = ok; // expect false: the guard reverts the reentrant create
        }
        _approve(owner, spender, value);
    }
}
