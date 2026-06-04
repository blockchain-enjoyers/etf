// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProofOfReserve} from "../interfaces/IProofOfReserve.sol";
import {IBasketFactory} from "../interfaces/IBasketFactory.sol";
import {IBasketVault} from "../interfaces/IBasketVault.sol";
import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title ProofOfReserve
/// @notice On-chain verifiable backing: the vault holds >= what the outstanding supply requires. [R4/R5]
/// @dev IMPLEMENTED v1: pure on-chain check (held vs required-by-units), no trust assumption. SKELETON v2:
///      submitAttestation for a signed off-chain custody report (custodiedBalance >= totalSupply). [R5]
contract ProofOfReserve is IProofOfReserve {
    IBasketFactory public immutable factory;

    struct Attestation {
        uint256 custodiedBalance;
        uint64 timestamp;
        bool set;
    }

    mapping(bytes32 => mapping(address => Attestation)) internal _attestation;

    constructor(address _factory) {
        factory = IBasketFactory(_factory);
    }

    /// @inheritdoc IProofOfReserve
    function isFullyBacked(bytes32 basketId) external view returns (bool) {
        address vault = factory.vaultOf(basketId);
        if (vault == address(0)) return false;
        MeridianTypes.Constituent[] memory cs = factory.constituentsOf(basketId);
        uint256 units = IBasketVault(vault).totalUnits();
        for (uint256 i = 0; i < cs.length; i++) {
            uint256 required = cs[i].unitQty * units;
            uint256 held = IBasketVault(vault).holdingOf(cs[i].token);
            if (held < required) return false;
        }
        return true;
    }

    /// @inheritdoc IProofOfReserve
    function reserveStatus(bytes32 basketId)
        external
        view
        returns (address[] memory tokens, uint256[] memory held, uint256[] memory required)
    {
        address vault = factory.vaultOf(basketId);
        MeridianTypes.Constituent[] memory cs = factory.constituentsOf(basketId);
        uint256 units = IBasketVault(vault).totalUnits();
        tokens = new address[](cs.length);
        held = new uint256[](cs.length);
        required = new uint256[](cs.length);
        for (uint256 i = 0; i < cs.length; i++) {
            tokens[i] = cs[i].token;
            held[i] = IBasketVault(vault).holdingOf(cs[i].token);
            required[i] = cs[i].unitQty * units;
        }
    }

    /// @inheritdoc IProofOfReserve
    function submitAttestation(
        bytes32 basketId,
        address token,
        uint256 custodiedBalance,
        uint64 timestamp,
        bytes calldata /*signature*/
    ) external {
        // TODO: verify the RedStone/attestor signature before trusting. [R5]
        _attestation[basketId][token] =
            Attestation({custodiedBalance: custodiedBalance, timestamp: timestamp, set: true});
        emit AttestationSubmitted(basketId, custodiedBalance, timestamp);
    }

    function attestationOf(bytes32 basketId, address token) external view returns (Attestation memory) {
        return _attestation[basketId][token];
    }
}
