// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IERC20} from "../interfaces/external/IERC20.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";
import {Roles} from "../types/MeridianTypes.sol";

/// @title BasketVault
/// @notice IMMUTABLE spine. ERC-4626-style: the vault IS the basket token. Custodies underlying tokenized
///         stocks, mints/burns in-kind (oracle-free), enforces its own safety invariants. [R3/R4 §4.1]
/// @dev No proxy: the contract holding assets can never be upgraded => strongest non-custodial claim (§2/§6).
///      Engines are resolved through the immutable ModuleRegistry and may act only within vault invariants.
///      IMPLEMENTED: in-kind mint/redeem (the spine, oracle-free) + ERC20 + views.
///      SKELETON (revert NotImplemented): executeRebalance / applySplit / accrueDividend — they need an oracle
///      value check, a swap router and holder accounting; filled in a later pass. [matrix #4,5,12]
contract BasketVault is IBasketVault {
    error NotImplemented();

    // -- immutable wiring ----------------------------------------------------
    bytes32 public immutable override basketId;
    IModuleRegistry public immutable _registry;
    uint256 public immutable creationUnitSize; // basket tokens minted per one full unit deposit

    // -- basket definition (set once at construction) ------------------------
    MeridianTypes.Constituent[] internal _constituents;
    mapping(address => uint256) public unitQtyOf; // native-decimal qty per creation unit
    mapping(address => bool) public isConstituent;

    uint256 public override totalUnits;

    // -- embedded ERC-20 (the basket token) ----------------------------------
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyEngine(bytes32 role) {
        if (msg.sender != _registry.tryGet(role)) revert NotAuthorizedEngine(role);
        _;
    }

    constructor(
        bytes32 _basketId,
        address registry_,
        uint256 _creationUnitSize,
        MeridianTypes.Constituent[] memory cs,
        string memory _name,
        string memory _symbol
    ) {
        basketId = _basketId;
        _registry = IModuleRegistry(registry_);
        creationUnitSize = _creationUnitSize;
        name = _name;
        symbol = _symbol;
        for (uint256 i = 0; i < cs.length; i++) {
            _constituents.push(cs[i]);
            unitQtyOf[cs[i].token] = cs[i].unitQty;
            isConstituent[cs[i].token] = true;
        }
    }

    // ========================================================================
    // In-kind create / redeem — ORACLE-FREE. The whole non-custodial claim. [R3]
    // ========================================================================

    /// @inheritdoc IBasketVault
    function mint(uint256 units, address to) external returns (uint256 basketTokenAmount) {
        if (units == 0) revert ZeroUnits();
        // Pull the exact bundle for `units` creation-units. A short transfer reverts the whole mint.
        uint256 n = _constituents.length;
        for (uint256 i = 0; i < n; i++) {
            address token = _constituents[i].token;
            uint256 needed = unitQtyOf[token] * units;
            uint256 balBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).transferFrom(msg.sender, address(this), needed);
            uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
            if (received < needed) revert IncompleteBundle(token, needed, received);
        }
        basketTokenAmount = creationUnitSize * units;
        totalUnits += units;
        _mint(to, basketTokenAmount);
        emit Minted(to, units, basketTokenAmount);
    }

    /// @inheritdoc IBasketVault
    /// @dev Pro-rata redemption: out_i = holding_i * amount / totalSupply (works after rebalance too).
    ///      UNCONDITIONAL — no engine can pause this (ETF-honesty property). [R4]
    function redeem(uint256 basketTokenAmount, address to) external returns (uint256 units) {
        if (basketTokenAmount == 0) revert ZeroUnits();
        uint256 supply = totalSupply;
        uint256 n = _constituents.length;
        // burn first (CEI) then transfer out pro-rata
        _burn(msg.sender, basketTokenAmount);
        for (uint256 i = 0; i < n; i++) {
            address token = _constituents[i].token;
            uint256 held = IERC20(token).balanceOf(address(this));
            uint256 out = (held * basketTokenAmount) / supply;
            if (out > 0) IERC20(token).transfer(to, out);
        }
        units = basketTokenAmount / creationUnitSize;
        // best-effort unit accounting (informational)
        if (units <= totalUnits) totalUnits -= units;
        emit Redeemed(msg.sender, basketTokenAmount, units);
    }

    // ========================================================================
    // Privileged, engine-driven — SKELETON. Bounded by vault invariants. [§2 trust model]
    // ========================================================================

    /// @inheritdoc IBasketVault
    function executeRebalance(address tokenIn, address tokenOut, uint256, uint256, bytes calldata)
        external
        onlyEngine(Roles.REBALANCER)
    {
        if (!isConstituent[tokenIn] || !isConstituent[tokenOut]) revert ConstituentNotWhitelisted(tokenIn);
        // TODO: route swap via approved router; re-read NAV via OracleRouter; require value-preserving within
        //       maxSlippageBps; honor weight-change timelock; never transfer to an arbitrary address. [R1/§2]
        revert NotImplemented();
    }

    /// @inheritdoc IBasketVault
    function applySplit(uint256, uint256) external onlyEngine(Roles.CORP_ACTIONS) {
        // TODO: scale unitQtyOf for the split constituent; preserve per-share backing invariant. [R3 unit-math]
        revert NotImplemented();
    }

    /// @inheritdoc IBasketVault
    function accrueDividend(uint256) external onlyEngine(Roles.CORP_ACTIONS) {
        // TODO: book cash dividend into a per-share claims ledger for pro-rata payout/reinvest. [R3]
        revert NotImplemented();
    }

    // ========================================================================
    // Views
    // ========================================================================

    function basketToken() external view returns (address) {
        return address(this); // the vault IS the share token
    }

    function registry() external view returns (address) {
        return address(_registry);
    }

    function holdingOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function constituents() external view returns (MeridianTypes.Constituent[] memory) {
        return _constituents;
    }

    // ========================================================================
    // Minimal ERC-20 internals
    // ========================================================================

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "BasketVault: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BasketVault: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BasketVault: burn");
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
