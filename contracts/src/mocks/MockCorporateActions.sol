// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title MockCorporateActions
/// @notice Settable corporate-action source, shaped like Chainlink Tokenized Asset v10. [R3/R5]
/// @dev Real source is BLOCKED in v1 (unshipped Robinhood APIs, §10). This mock lets tests fire a split or
///      dividend per (basket, token). CorporateActionsModule reads from here.
contract MockCorporateActions {
    /// @dev keyed by (basketId, token)
    mapping(bytes32 => mapping(address => MeridianTypes.CorpAction)) internal _action;

    function setSplit(bytes32 basketId, address token, uint256 ratioNum, uint256 ratioDen, uint64 eventDate)
        external
    {
        _action[basketId][token] = MeridianTypes.CorpAction({
            actionType: MeridianTypes.CorpActionType.Split,
            eventDate: eventDate,
            splitRatioNum: ratioNum,
            splitRatioDen: ratioDen,
            dividendPerShare: 0,
            reinvest: false
        });
    }

    function setDividend(bytes32 basketId, address token, uint256 perShare, bool reinvest, uint64 eventDate)
        external
    {
        _action[basketId][token] = MeridianTypes.CorpAction({
            actionType: MeridianTypes.CorpActionType.Dividend,
            eventDate: eventDate,
            splitRatioNum: 0,
            splitRatioDen: 0,
            dividendPerShare: perShare,
            reinvest: reinvest
        });
    }

    function clear(bytes32 basketId, address token) external {
        delete _action[basketId][token];
    }

    /// @notice Latest pending action for a constituent (None if unset).
    function latestAction(bytes32 basketId, address token)
        external
        view
        returns (MeridianTypes.CorpAction memory)
    {
        return _action[basketId][token];
    }
}
