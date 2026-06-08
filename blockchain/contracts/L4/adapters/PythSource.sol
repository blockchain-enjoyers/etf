// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @title PythSource — Pyth pull oracle (update in-tx, read, conf->synthetic depth) (R13 §1/§2)
/// @notice read(payload): updatePriceFeeds{value:fee}(updateData) then getPriceNoOlderThan. The update fee
///         is assumed 0 (RHC/testnets, like Chainlink-verify-free); a non-zero-fee payment path is a
///         deferred IMP. price/conf scaled by expo to 1e18; depth is synthetic (tighter conf => deeper).
contract PythSource is IPriceSource {
    IPyth public immutable pyth;
    bytes32 public immutable id;
    uint256 public immutable maxAge; // seconds
    uint256 public immutable kDepth; // synthetic-depth scale: depth = kDepth*price/conf

    /// @dev The update fee is assumed 0 (deferred IMP: a prepaid/payable path for fee-charging chains).
    ///      Fail explicitly here rather than via an opaque value-call revert if a chain charges a fee.
    error PythFeeUnsupported(uint256 fee);

    constructor(address pyth_, bytes32 id_, uint256 maxAge_, uint256 kDepth_) {
        pyth = IPyth(pyth_);
        id = id_;
        maxAge = maxAge_;
        kDepth = kDepth_;
    }

    function read(bytes calldata payload) external returns (SourceReading memory r) {
        bytes[] memory updateData = abi.decode(payload, (bytes[]));
        uint256 fee = pyth.getUpdateFee(updateData);
        if (fee != 0) revert PythFeeUnsupported(fee); // value cannot flow through the non-view aggregator call
        pyth.updatePriceFeeds{value: 0}(updateData);
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(id, maxAge);

        // non-positive price => unhealthy, zero everything (never coerce a negative into a huge uint).
        uint256 price1e18 = p.price > 0 ? _scale(uint64(int64(p.price)), p.expo) : 0;
        uint256 conf1e18 = _scale(p.conf, p.expo);
        r.price = price1e18;
        r.confidence = conf1e18;
        r.depth = (price1e18 == 0 || conf1e18 == 0) ? 0 : (kDepth * price1e18) / conf1e18;
        r.lastUpdate = uint64(p.publishTime);
        r.kind = SourceKind.ORACLE_PULL;
        r.weekendAware = false; // equity feeds stale off-hours; governance flag per feed
        r.healthy = price1e18 > 0;
    }

    function describe() external view returns (string memory, address) {
        return ("pyth", address(pyth));
    }

    /// @dev Pyth value = v * 10^expo; rescale to 1e18. expo is typically negative.
    function _scale(uint64 v, int32 expo) private pure returns (uint256) {
        if (expo <= 0) {
            uint256 d = uint256(int256(-expo));
            return d >= 18 ? uint256(v) / (10 ** (d - 18)) : uint256(v) * (10 ** (18 - d));
        }
        return uint256(v) * (10 ** uint256(int256(expo))) * 1e18;
    }
}
