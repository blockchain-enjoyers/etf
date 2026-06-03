// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MeridianTypes} from "../types/MeridianTypes.sol";

/// @title IOracleAdapter
/// @notice One pluggable price source normalized into a common reading. [R5]
/// @dev Every source (Chainlink, Pyth, RedStone, DEX-TWAP, perp-mark) implements this so OracleRouter
///      can fuse them without knowing their internals. Adapters normalize to 18-dec price.
interface IOracleAdapter {
    /// @param asset  the tokenized-stock token address this reading is for
    function read(address asset) external view returns (MeridianTypes.OracleReading memory);

    /// @notice Source tag this adapter reports (for fusion ordering / divergence accounting).
    function sourceType() external view returns (MeridianTypes.OracleSource);

    /// @notice Whether this adapter currently has a usable (fresh enough) reading for `asset`.
    function isAvailable(address asset) external view returns (bool);
}
