// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRebalanceEngine} from "../interfaces/IRebalanceEngine.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";
import {Roles} from "../types/MeridianTypes.sol";

/// @title RebalanceEngine
/// @notice Curator-weighted rebalancing with a v1 freshness gate. [R1 Tilt / R7]
/// @dev IMPLEMENTED: weight proposal + time-lock storage, and the v1 GATE — rebalance reverts unless the
///      oracle is fresh AND Regular AND the sequencer is healthy (else weekend/stale/halt = pause). [R7 Kamino]
///      SKELETON: the swap itself delegates to BasketVault.executeRebalance (NotImplemented until a router +
///      value-preserving check are wired). [matrix #2,12]
contract RebalanceEngine is IRebalanceEngine {
    IBasketFactory public immutable factory;
    IModuleRegistry public immutable registry;
    uint64 public weightTimelock = 1 days;

    mapping(bytes32 => address) public curatorOf;
    mapping(bytes32 => MeridianTypes.Constituent[]) internal _targets;
    mapping(bytes32 => MeridianTypes.Constituent[]) internal _pending;
    mapping(bytes32 => uint64) internal _eta;

    constructor(address _factory, address _registry) {
        factory = IBasketFactory(_factory);
        registry = IModuleRegistry(_registry);
    }

    function setCurator(bytes32 basketId, address curator) external {
        // first-come or governor-set; simplified for scaffold
        require(curatorOf[basketId] == address(0), "Rebalance: curator set");
        curatorOf[basketId] = curator;
    }

    /// @inheritdoc IRebalanceEngine
    function proposeWeights(bytes32 basketId, MeridianTypes.Constituent[] calldata targets) external {
        if (msg.sender != curatorOf[basketId]) revert NotCurator();
        uint256 sum;
        for (uint256 i = 0; i < targets.length; i++) {
            sum += targets[i].weightBps;
        }
        if (sum != 10_000) revert WeightsNot10000(sum);
        delete _pending[basketId];
        for (uint256 i = 0; i < targets.length; i++) {
            _pending[basketId].push(targets[i]);
        }
        _eta[basketId] = uint64(block.timestamp) + weightTimelock;
        emit WeightsProposed(basketId, _eta[basketId]);
    }

    /// @inheritdoc IRebalanceEngine
    function commitWeights(bytes32 basketId) external {
        uint64 eta = _eta[basketId];
        if (eta == 0 || block.timestamp < eta) revert WeightTimelockNotElapsed(basketId, eta);
        delete _targets[basketId];
        MeridianTypes.Constituent[] storage p = _pending[basketId];
        for (uint256 i = 0; i < p.length; i++) {
            _targets[basketId].push(p[i]);
        }
        delete _pending[basketId];
        _eta[basketId] = 0;
        emit WeightsCommitted(basketId);
    }

    /// @inheritdoc IRebalanceEngine
    function rebalance(bytes32 basketId, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
    {
        // v1 GATE: only when the oracle is fresh + Regular + sequencer healthy. [R7]
        IOracleRouter router = IOracleRouter(registry.get(Roles.ORACLE_ROUTER));
        if (!router.isFreshRegular(tokenIn) || !router.isFreshRegular(tokenOut)) {
            revert MarketNotFreshRegular(basketId);
        }
        address vault = factory.vaultOf(basketId);
        // Vault enforces value-preservation + whitelist + no arbitrary transfer. (executeRebalance is skeleton.)
        IBasketVault(vault).executeRebalance(tokenIn, tokenOut, amountIn, minAmountOut, "");
        emit RebalanceExecuted(basketId, tokenIn, tokenOut, amountIn);
    }

    function targetWeights(bytes32 basketId) external view returns (MeridianTypes.Constituent[] memory) {
        return _targets[basketId];
    }
}
