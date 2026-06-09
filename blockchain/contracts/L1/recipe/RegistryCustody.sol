// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC6909Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC6909/ERC6909Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RegistryCustody — ERC-6909 internal-accounting custody for constituent tokens
/// @notice The per-vault registry: the vault IS its own ERC-6909 ledger (the Uniswap-v4 PoolManager pattern).
///         Real ERC-20 constituents are deposited once at the `wrap` boundary and represented as ERC-6909 claim
///         ids (id = uint160(token)); thereafter index create/redeem move claims by INTERNAL reassignment with
///         no external transfers (the R16 gas / AP-capital-efficiency win). Real ERC-20 transfers happen ONLY
///         in wrap/unwrap. Raw-unit accounting (ERC-8056 split-safe); fee-on-transfer / true-rebasing tokens are
///         outside the supported model, same as L1.
abstract contract RegistryCustody is Initializable, ReentrancyGuardTransient, ERC6909Upgradeable {
    using SafeERC20 for IERC20;

    event Wrapped(address indexed token, address indexed account, uint256 amount);
    event Unwrapped(address indexed token, address indexed to, uint256 amount);

    function __RegistryCustody_init() internal onlyInitializing {
        __ERC6909_init();
    }

    /// @notice The ERC-6909 id for a constituent token.
    function idOf(address token) public pure returns (uint256) {
        return uint256(uint160(token));
    }

    /// @notice The constituent token for an ERC-6909 id.
    function tokenOf(uint256 id) public pure returns (address) {
        return address(uint160(id));
    }

    /// @notice Deposit `amount` of real `token`, receive an equal ERC-6909 claim id. The ONLY external pull-in.
    function wrap(address token, uint256 amount) external nonReentrant {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, idOf(token), amount);
        emit Wrapped(token, msg.sender, amount);
    }

    /// @notice Burn `amount` of the caller's claim id, send the real `token` to `to`. The ONLY external send-out.
    function unwrap(address token, uint256 amount, address to) external nonReentrant {
        _burn(msg.sender, idOf(token), amount);
        IERC20(token).safeTransfer(to, amount);
        emit Unwrapped(token, to, amount);
    }

    // ---- custody port (consumed by the rebalance core in Part 2) ----

    /// @dev The vault's own custody balance of `token` (its claim-id balance).
    function _custodyBalance(address token) internal view returns (uint256) {
        return balanceOf(address(this), idOf(token));
    }

    /// @dev Move `amount` of `token`'s claim from `from` into the vault via internal _transfer, which
    ///      performs NO ERC-6909 allowance/operator check. The leaf MUST call this only with
    ///      from == msg.sender (the caller moving their OWN claims); passing any other `from` would move
    ///      a third party's claims. Enforced by the leaf, not here.
    function _custodyIn(address from, address token, uint256 amount) internal {
        _transfer(from, address(this), idOf(token), amount);
    }

    /// @dev Move `amount` of `token`'s claim from the vault to `to`.
    function _custodyOut(address to, address token, uint256 amount) internal {
        _transfer(address(this), to, idOf(token), amount);
    }
}
