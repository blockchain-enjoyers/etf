// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INAVEngine} from "../interfaces/INAVEngine.sol";
import {IModuleRegistry} from "../interfaces/IModuleRegistry.sol";
import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";
import {Roles} from "../types/MeridianTypes.sol";

/// @title NAVEngine
/// @notice Read-only NAV + confidence band. The demo wedge. [R4 §4.3]
/// @dev IMPLEMENTED v1: market-hours weighted sum `nav = Σ holdingᵢ·priceᵢ` via OracleRouter.lastReading;
///      `estimated=true` whenever any constituent is not Regular/fresh (weekend/halt) => NEVER settlement.
///      SKELETON v2: setFairValueAttestation stores an OFF-CHAIN-fitted closed-market fair value (no on-chain
///      regression). [R4/R6]  IRON RULE enforced by the `estimated` flag. [R4]
contract NAVEngine is INAVEngine {
    IBasketFactory public immutable factory;
    IModuleRegistry public immutable registry;

    struct Attestation {
        uint256 nav;
        uint256 lower;
        uint256 upper;
        uint64 timestamp;
        bool set;
    }

    mapping(bytes32 => Attestation) internal _attestation; // v2 closed-market fair value
    uint64 public attestationTtl = 1 hours; // OSM-like freshness for the off-chain value [R7]

    constructor(address _factory, address _registry) {
        factory = IBasketFactory(_factory);
        registry = IModuleRegistry(_registry);
    }

    function _router() internal view returns (IOracleRouter) {
        return IOracleRouter(registry.get(Roles.ORACLE_ROUTER));
    }

    /// @inheritdoc INAVEngine
    function latestNAV(bytes32 basketId) external view returns (MeridianTypes.NavResult memory res) {
        address vault = factory.vaultOf(basketId);
        require(vault != address(0), "NAV: unknown basket");

        // v2 fair-value attestation takes precedence when set and fresh (still marked estimated). [R4]
        Attestation memory att = _attestation[basketId];
        if (att.set && block.timestamp - att.timestamp <= attestationTtl) {
            return MeridianTypes.NavResult({
                nav: att.nav,
                confidenceLower: att.lower,
                confidenceUpper: att.upper,
                marketStatus: MeridianTypes.MarketStatus.Closed,
                estimated: true, // closed-market fair value is ALWAYS estimated
                timestamp: att.timestamp
            });
        }

        IOracleRouter router = _router();
        MeridianTypes.Constituent[] memory cs = IBasketVault(vault).constituents();

        uint256 nav;
        uint256 band;
        bool estimated;
        MeridianTypes.MarketStatus status = MeridianTypes.MarketStatus.Regular;

        for (uint256 i = 0; i < cs.length; i++) {
            address token = cs[i].token;
            uint256 held = IBasketVault(vault).holdingOf(token); // 18-dec
            MeridianTypes.OracleReading memory r = router.lastReading(token); // non-reverting [R4]

            nav += (held * r.price) / 1e18; // 18-dec USD
            band += (held * r.confidence) / 1e18;

            if (r.marketStatus != MeridianTypes.MarketStatus.Regular) {
                estimated = true;
                status = r.marketStatus; // report the worst/last non-regular status
            }
        }

        res = MeridianTypes.NavResult({
            nav: nav,
            confidenceLower: nav > band ? nav - band : 0,
            confidenceUpper: nav + band,
            marketStatus: status,
            estimated: estimated, // weekend/halt => true => NOT a settlement price [R4]
            timestamp: uint64(block.timestamp)
        });
    }

    /// @inheritdoc INAVEngine
    function marketStatus(bytes32 basketId) external view returns (MeridianTypes.MarketStatus) {
        address vault = factory.vaultOf(basketId);
        require(vault != address(0), "NAV: unknown basket");
        MeridianTypes.Constituent[] memory cs = IBasketVault(vault).constituents();
        IOracleRouter router = _router();
        for (uint256 i = 0; i < cs.length; i++) {
            MeridianTypes.MarketStatus s = router.lastReading(cs[i].token).marketStatus;
            if (s != MeridianTypes.MarketStatus.Regular) return s;
        }
        return MeridianTypes.MarketStatus.Regular;
    }

    /// @inheritdoc INAVEngine
    /// @dev v2 entry. The fitter (off-chain) signs (nav, band, timestamp); engine validates + stores. Here the
    ///      signature check is a placeholder until the attestor key/threshold scheme is chosen. [R4/R6]
    function setFairValueAttestation(
        bytes32 basketId,
        uint256 nav,
        uint256 confidenceLower,
        uint256 confidenceUpper,
        uint64 timestamp,
        bytes calldata /*signature*/
    ) external {
        // TODO: verify attestor signature / threshold before trusting. [R4 Rule 2a-5 valuation designee]
        require(msg.sender == registry.get(Roles.NAV_ENGINE) || msg.sender == address(this), "NAV: attestor");
        _attestation[basketId] =
            Attestation({nav: nav, lower: confidenceLower, upper: confidenceUpper, timestamp: timestamp, set: true});
        emit FairValueAttestationSet(basketId, keccak256(abi.encode(nav, confidenceLower, confidenceUpper)), timestamp);
    }
}
