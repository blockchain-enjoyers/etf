// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IProofOfReserve
/// @notice Makes honest backing verifiable on-chain: vault holds exactly the PCF constituents and the held
///         quantity covers what the outstanding basket-token supply requires. [R4/R5 RedStone pattern]
/// @dev v1: on-chain snapshot of vault composition vs supply. v2: + signed off-chain custody attestation
///      (custodiedBalance >= totalSupply). PoR attests BACKING quality, not price. [R5]
interface IProofOfReserve {
    event ReserveVerified(bytes32 indexed basketId, bool healthy);
    event AttestationSubmitted(bytes32 indexed basketId, uint256 custodiedBalance, uint64 timestamp);

    error UnderReserved(bytes32 basketId, address token, uint256 held, uint256 required);
    error AttestationInvalid(bytes32 basketId);

    /// @notice True iff, for every constituent, held >= required-by-supply. Pure on-chain check. [R4]
    function isFullyBacked(bytes32 basketId) external view returns (bool);

    /// @notice Per-constituent (held, required) so consumers can display the proof.
    function reserveStatus(bytes32 basketId)
        external
        view
        returns (address[] memory tokens, uint256[] memory held, uint256[] memory required);

    /// @notice v2 — submit a signed custody attestation for the underlying real shares. [R5]
    function submitAttestation(
        bytes32 basketId,
        address token,
        uint256 custodiedBalance,
        uint64 timestamp,
        bytes calldata signature
    ) external;
}
