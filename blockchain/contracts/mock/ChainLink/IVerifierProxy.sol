// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IVerifierProxy — Chainlink Data Streams on-chain verification entrypoint (vendor interface)
/// @notice Minimal interface for the Data Streams pull model. A consumer fetches a DON-signed report
///         OFF-CHAIN (REST/WebSocket/SDK or StreamsLookup) and submits it here to be verified
///         ON-CHAIN in the same tx; `verify` returns the decoded report bytes (abi.encode of the
///         schema struct), which the caller abi.decodes. This is NOT latestRoundData() — there is no
///         pushed value to read; the price arrives with the call.
/// @dev Vendor-specific: lives under mock/ChainLink so the neutral L2 product code never imports it.
///      Signature CONFIRMED against the live RHC-testnet VerifierProxy v2.0.0 at
///      0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64 (chain 46630):
///        verify(bytes payload, bytes parameterPayload) payable returns (bytes)
///      On that testnet s_feeManager() == address(0) (verification is free) and
///      s_accessController() == address(0) (verification is permissionless). On mainnet billing is
///      subscription-based (the per-verification model is deprecated); do NOT hardcode a per-call fee.
interface IVerifierProxy {
    /// @param payload          the full DON-signed report blob (report context + data + signatures).
    /// @param parameterPayload billing/parameter payload (e.g. fee-token selector); empty when free.
    /// @return verifierResponse abi-encoded verified report data, decodable into the schema struct.
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);
}
