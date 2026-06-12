// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IStock} from "./interfaces/IStock.sol";

/// @title StockCloneFactory — deploy + initialize an EIP-1167 minimal clone of a Stock impl in one tx.
/// @dev The clone delegatecalls the impl; the impl's immutable ACCESS_CONTROLLED_REGISTRY is read from
///      impl code, so all clones share the registry the impl was deployed with. Far cheaper than ERC1967.
contract StockCloneFactory {
    event StockCreated(address indexed stock, string symbol);

    function create(address impl, bytes32 uid, string calldata name, string calldata symbol)
        external
        returns (address clone)
    {
        clone = Clones.clone(impl);
        IStock(clone).initialize(uid, name, symbol);
        emit StockCreated(clone, symbol);
    }
}
