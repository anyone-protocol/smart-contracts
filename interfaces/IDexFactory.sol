// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

interface IDexFactory {
    function createPair(address tokenA, address tokenB)
        external
        returns (address pair);
}
