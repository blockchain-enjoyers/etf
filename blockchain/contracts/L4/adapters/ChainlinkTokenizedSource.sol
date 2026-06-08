// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IPriceSource, SourceReading, SourceKind} from "../IPriceSource.sol";
import {IVerifierProxy} from "../../mock/ChainLink/IVerifierProxy.sol";
import {ReportV10} from "../../mock/ChainLink/ChainlinkReports.sol";

/// @title ChainlinkTokenizedSource — Chainlink v10 Tokenized Asset (weekend tokenizedPrice)
/// @notice read(payload): verify -> decode ReportV10. When the underlying equity market is Closed the
///         `price` is frozen, so we surface `tokenizedPrice` (CEX secondary, live on weekends) with
///         weekendAware=true; during an open session we surface `price * currentMultiplier`. THE
///         on-chain-readable weekend signal (R13 §5). depth = governance synthetic tier (no pool).
contract ChainlinkTokenizedSource is IPriceSource {
    IVerifierProxy public immutable verifierProxy;
    uint256 public immutable depthTier;

    constructor(IVerifierProxy verifierProxy_, uint256 depthTier_) {
        verifierProxy = verifierProxy_;
        depthTier = depthTier_;
    }

    function read(bytes calldata payload) external returns (SourceReading memory r) {
        ReportV10 memory v = abi.decode(verifierProxy.verify(payload, bytes("")), (ReportV10));
        r.kind = SourceKind.RWA_STREAM;
        r.depth = depthTier;
        r.confidence = 0;
        r.lastUpdate = uint64(uint256(v.lastUpdateTimestamp) / 1e9);
        if (v.marketStatus == 5) {
            // Closed: underlying frozen, tokenizedPrice live from CEX secondary markets.
            r.price = v.tokenizedPrice > 0 ? uint256(int256(v.tokenizedPrice)) : 0;
            r.weekendAware = true;
            r.healthy = r.price > 0;
        } else {
            // Open session: theoretical price = underlying price * the 1e18-scaled multiplier.
            uint256 px = v.price > 0 ? uint256(int256(v.price)) : 0;
            r.price = (px * v.currentMultiplier) / 1e18;
            r.weekendAware = false;
            r.healthy = r.price > 0 && v.marketStatus >= 1 && v.marketStatus <= 4;
        }
    }

    function describe() external view returns (string memory, address) {
        return ("chainlink-tokenized-v10", address(verifierProxy));
    }
}
