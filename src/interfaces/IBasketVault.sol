// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title IBasketVault
/// @notice The immutable spine: custodies underlying tokenized stocks, mints/burns the basket token
///         in-kind, and enforces its own safety invariants. ORACLE-FREE for create/redeem. [R3/R4 §4.1]
/// @dev Immutable (no proxy) = strongest non-custodial claim. Engines are resolved through an immutable
///      ModuleRegistry reference and may only act WITHIN vault-enforced bounds (engines propose, vault disposes).
interface IBasketVault {
    // -- create / redeem (oracle-free, in-kind) ------------------------------
    event Minted(address indexed to, uint256 units, uint256 basketTokenAmount);
    event Redeemed(address indexed from, uint256 basketTokenAmount, uint256 units);
    event Rebalanced(address indexed by, bytes32 indexed basketId);
    event DividendAccrued(uint256 perShare, uint256 total);
    event SplitApplied(uint256 ratioNum, uint256 ratioDen);

    error IncompleteBundle(address token, uint256 needed, uint256 provided);
    error VaultDepleted(address token);
    error NotAuthorizedEngine(bytes32 role);
    error RebalanceNotValuePreserving(uint256 before_, uint256 after_);
    error ConstituentNotWhitelisted(address token);
    error ZeroUnits();

    /// @notice Deposit exact constituent quantities for `units` creation-units and mint the basket token.
    /// @dev Reverts (IncompleteBundle) if any constituent transfer is short. No price used. [R3 in-kind]
    function mint(uint256 units, address to) external returns (uint256 basketTokenAmount);

    /// @notice Burn basket tokens and receive pro-rata underlying. UNCONDITIONAL — never pausable. [R4 honesty]
    function redeem(uint256 basketTokenAmount, address to) external returns (uint256 units);

    // -- privileged, bounded by vault invariants -----------------------------

    /// @notice Execute a constituent swap proposed by the REBALANCER engine.
    /// @dev Vault verifies: whitelisted tokens, value-preserving within slippage, no transfer-out to arbitrary
    ///      address, weight-change timelock honored. A malicious engine cannot exceed these. [trust model §2]
    function executeRebalance(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata routerCalldata
    ) external;

    /// @notice Apply a stock split to the holdings ledger / unit-math. Callable only by CORP_ACTIONS engine.
    function applySplit(uint256 ratioNum, uint256 ratioDen) external;

    /// @notice Accrue a cash dividend pro-rata to basket-token holders (claims ledger). CORP_ACTIONS only.
    function accrueDividend(uint256 perShare) external;

    // -- views ---------------------------------------------------------------
    function basketId() external view returns (bytes32);
    function basketToken() external view returns (address);
    function registry() external view returns (address);
    function holdingOf(address token) external view returns (uint256);
    function constituents() external view returns (MeridianTypes.Constituent[] memory);
    function totalUnits() external view returns (uint256);
}
