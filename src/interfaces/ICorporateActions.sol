// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title ICorporateActions
/// @notice Applies splits (unit-math) and dividends (cash accrual) to a basket. [R3 "genuine difficulty"]
/// @dev BLOCKED on real data in v1 (unshipped Robinhood APIs, §10): interface + mock now, real Chainlink
///      Tokenized Asset v10 feed later. Splits update the Factory PCF unit-qty + vault ledger; dividends
///      accrue pro-rata to basket-token holders (reinvest vs payout). [R3/R5]
interface ICorporateActions {
    event SplitProcessed(bytes32 indexed basketId, address token, uint256 ratioNum, uint256 ratioDen);
    event DividendProcessed(bytes32 indexed basketId, address token, uint256 perShare, bool reinvest);

    error UnsupportedAction(MeridianTypes.CorpActionType actionType);
    error ActionAlreadyProcessed(bytes32 basketId, uint64 eventDate);
    error ActionSourceUnavailable();

    /// @notice Pull the latest corporate action for a constituent from the (mock/real) feed and apply it.
    function processAction(bytes32 basketId, address token) external;

    /// @notice Apply a known action explicitly (used by tests / mock-driven flows).
    function applyAction(bytes32 basketId, address token, MeridianTypes.CorpAction calldata action) external;

    /// @notice Pending claimable dividend for a holder on a basket (in cashToken units).
    function claimableDividend(bytes32 basketId, address holder) external view returns (uint256);

    /// @notice Claim accrued dividends.
    function claim(bytes32 basketId) external returns (uint256 amount);
}
