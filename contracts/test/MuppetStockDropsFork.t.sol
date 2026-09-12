// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MuppetStockDrops} from "../src/MuppetStockDrops.sol";

contract MuppetStockDropsForkTest is Test {
    function testCanonicalStockTransfersOnReadOnlyMainnetFork() public {
        vm.skip(!vm.envOr("RUN_STOCK_DROPS_FORK", false));
        vm.createSelectFork("robinhood_mainnet");
        address[] memory tokens = new address[](4);
        tokens[0] = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
        tokens[1] = 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC;
        tokens[2] = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
        tokens[3] = 0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA;
        MuppetStockDrops drops = new MuppetStockDrops(address(this), 0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189, tokens);
        address recipient = makeAddr("local-fork-recipient");
        for (uint256 id; id < tokens.length; ++id) {
            IERC20 token = IERC20(tokens[id]);
            // Synthetic local funding only. This does not buy or transfer mainnet assets.
            deal(tokens[id], address(this), 1 ether);
            token.approve(address(drops), 1 ether);
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(drops), id, uint256(0), recipient, uint256(1 ether)))));
            drops.fundDrop(id, tokens[id], 1 ether, 100, keccak256("fork-only snapshot"), leaf, keccak256("fork-only manifest"));
            drops.claim(id, 0, recipient, 1 ether, new bytes32[](0));
            assertEq(token.balanceOf(recipient), 1 ether);
            assertEq(drops.liability(tokens[id]), 0);
        }
    }
}
