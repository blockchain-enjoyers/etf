// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockRedStonePoR
/// @notice Settable Proof-of-Reserve attestation source (RedStone pattern). [R5]
/// @dev Real PoR is a signed report {asset, totalSupply, custodiedBalance, timestamp, signature}; the
///      consumer checks custodiedBalance >= totalSupply. Here signature validation is stubbed (always-valid)
///      and custodiedBalance is settable so tests can simulate healthy vs under-reserved backing.
contract MockRedStonePoR {
    struct Report {
        uint256 custodiedBalance;
        uint64 timestamp;
        bool valid;
    }

    mapping(address => Report) internal _reports; // keyed by underlying token

    function setReserve(address token, uint256 custodiedBalance, uint64 timestamp) external {
        _reports[token] = Report({custodiedBalance: custodiedBalance, timestamp: timestamp, valid: true});
    }

    function invalidate(address token) external {
        _reports[token].valid = false;
    }

    function custodiedBalanceOf(address token) external view returns (uint256) {
        return _reports[token].custodiedBalance;
    }

    /// @notice Mock signature verification — always true unless explicitly invalidated.
    function verify(address token, bytes calldata) external view returns (bool) {
        return _reports[token].valid;
    }

    function reportOf(address token) external view returns (Report memory) {
        return _reports[token];
    }
}
