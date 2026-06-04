// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MeridianTypes
/// @notice Shared enums, structs and role identifiers for the Meridian modular vault system.
/// @dev See docs/specs/2026-06-03-meridian-contracts-architecture.md. Constraint tags [R#] point at research.
library MeridianTypes {
    // -------------------------------------------------------------------------
    // Market status — mirrors Chainlink Equities Data Streams marketStatus 0-5 [R5]
    // -------------------------------------------------------------------------
    enum MarketStatus {
        Unknown, //     0  feed error / halt — treat as degraded
        PreMarket, //   1  04:00-09:30 ET
        Regular, //     2  09:30-16:00 ET  (the only state v1 trusts for rebalance/settlement)
        PostMarket, //  3  16:00-20:00 ET
        Overnight, //   4  20:00-04:00 ET (Sun-Thu)
        Closed //       5  Fri 20:00 ET -> Sun 20:00 ET weekend; no price discovery, deliberately stale
    }

    // -------------------------------------------------------------------------
    // Oracle source tag — fusion fallback ordering [R5]
    // -------------------------------------------------------------------------
    enum OracleSource {
        Chainlink, //  0  24/5 equities anchor (table stakes)
        Pyth, //       1  confidence-interval first-party
        RedStone, //   2  HyperStone off-hours
        DexTwap, //    3  on-chain tokenized-stock TWAP (v2, never settlement)
        PerpMark, //   4  equity/index perp mark (v2 signal)
        LastClose //   5  Friday consolidation fallback
    }

    /// @notice Normalized reading every IOracleAdapter must return. [R5]
    struct OracleReading {
        uint256 price; //         canonical 18-dec USD price (adapters normalize from native decimals)
        uint256 confidence; //    half-width of the band in price units (Pyth-style); 0 = exact
        uint64 timestamp; //      seconds; staleness = block.timestamp - timestamp
        MarketStatus marketStatus;
        OracleSource source;
    }

    /// @notice Result returned by NAVEngine.latestNAV. The IRON RULE lives in `estimated`. [R4]
    struct NavResult {
        uint256 nav; //              basket NAV in 18-dec USD
        uint256 confidenceLower; //  nav - band
        uint256 confidenceUpper; //  nav + band
        MarketStatus marketStatus;
        bool estimated; //           true => closed-market fair value => NEVER a settlement price
        uint64 timestamp;
    }

    // -------------------------------------------------------------------------
    // Basket definition — on-chain PCF (Portfolio Composition File) [R3]
    // -------------------------------------------------------------------------
    struct Constituent {
        address token; //    tokenized stock (xStock-style ERC-20)
        uint256 unitQty; //  quantity (native decimals) per ONE creation unit
        uint256 weightBps; //target weight in basis points (sum across constituents = 10_000)
        uint8 decimals; //   token decimals (xStock typically 18)
    }

    struct BasketDefinition {
        bytes32 basketId;
        address basketToken; //       ERC-20 the vault mints/burns
        address cashToken; //         settlement cash leg (e.g. USDC, 6-dec) for forward queue; address(0) if none
        uint256 creationUnitSize; //  number of basket tokens minted per one full unit deposit
        uint256 cashComponentPerUnit; // cash amount (cashToken decimals) folded per unit; 0 for pure in-kind
        bool frozen; //               road-to-immutability: definition locked
    }

    // -------------------------------------------------------------------------
    // Corporate actions — Chainlink Tokenized Asset v10 shape [R3/R5] (mocked in v1)
    // -------------------------------------------------------------------------
    enum CorpActionType {
        None,
        Split, //     splitRatioNum/Den change unit-math
        Dividend, //  dividendPerShare cash accrual to holders
        Merger //     out of scope v1/v2; reserved
    }

    struct CorpAction {
        CorpActionType actionType;
        uint64 eventDate;
        uint256 splitRatioNum; //      e.g. 2 for a 2:1 split
        uint256 splitRatioDen; //      e.g. 1
        uint256 dividendPerShare; //   in cashToken decimals
        bool reinvest; //              true = reinvest, false = payout
    }

    // -------------------------------------------------------------------------
    // Forward-priced redemption queue entry (Rule 22c-1 port) [R4]
    // -------------------------------------------------------------------------
    enum QueueStatus {
        None,
        Pending, //   submitted in closed window, awaiting reopen
        Settled,
        Cancelled
    }

    struct QueueEntry {
        bytes32 basketId;
        address owner;
        uint256 basketTokenAmount; // amount of basket token to redeem for cash
        uint64 submittedAt;
        QueueStatus status;
        uint256 nonce; //             replay/dedup protection
    }
}

/// @title Roles
/// @notice ModuleRegistry slot identifiers. Engines are looked up by these ids.
library Roles {
    bytes32 internal constant ORACLE_ROUTER = keccak256("meridian.ORACLE_ROUTER");
    bytes32 internal constant NAV_ENGINE = keccak256("meridian.NAV_ENGINE");
    bytes32 internal constant REBALANCER = keccak256("meridian.REBALANCER");
    bytes32 internal constant CORP_ACTIONS = keccak256("meridian.CORP_ACTIONS");
    bytes32 internal constant CREATION_REDEMPTION = keccak256("meridian.CREATION_REDEMPTION");
    bytes32 internal constant TRIGGER_GUARD = keccak256("meridian.TRIGGER_GUARD");
    bytes32 internal constant PROOF_OF_RESERVE = keccak256("meridian.PROOF_OF_RESERVE");
}
