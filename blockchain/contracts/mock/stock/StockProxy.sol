// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title StockProxy — ERC1967 proxy so the upgradeable Stock mock can be initialized in tests.
/// @dev Stock disables initializers in its constructor, so it must run behind a proxy that calls
///      initialize() via the constructor `data`.
contract StockProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
