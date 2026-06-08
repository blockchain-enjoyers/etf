// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IVerifierProxy} from "./IVerifierProxy.sol";

// Test-only mock reproducing the RWA Data Streams pull/verify interface, so the Streams adapter can be
// exercised in Hardhat WITHOUT a network and WITHOUT a Streams API key. (The L2 Sequencer Uptime Feed
// mock was removed with the L2 cache stack.)

/// @title MockVerifierProxy — settable stand-in for Chainlink VerifierProxy (Data Streams pull model)
/// @notice Returns a caller-set, pre-encoded report blob from verify(). TEST SIMPLIFICATION: the real
///         `payload` is a DON-signed blob whose signature is checked on-chain; here we skip signatures
///         and signing entirely — the test abi-encodes a ReportV8/ReportV11 struct, hands it to
///         setVerifyResult, and verify() returns it verbatim. The ADAPTER under test is real (it forwards
///         the payload, then decodes/validates the returned report bytes), so only the signing/billing is
///         faked. verify is intentionally free (no FeeManager), matching the RHC testnet where
///         s_feeManager() == address(0); the forwarded `payload` is therefore ignored here.
contract MockVerifierProxy is IVerifierProxy {
    bytes private _verifyResult;

    /// @notice Set the abi-encoded report bytes that verify() will return.
    function setVerifyResult(bytes calldata verifyResult) external {
        _verifyResult = verifyResult;
    }

    /// @inheritdoc IVerifierProxy
    function verify(bytes calldata /*payload*/, bytes calldata /*parameterPayload*/)
        external
        payable
        returns (bytes memory)
    {
        return _verifyResult;
    }
}
