// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {MuppetStockDrops} from "../src/MuppetStockDrops.sol";

interface IStockDropSafe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

/// @dev Run without --broadcast to simulate. No existing contract or fee route is modified.
contract DeployStockDrops is Script {
    function run() external returns (MuppetStockDrops stockDrops) {
        require(block.chainid == 4663, "Robinhood mainnet required");
        address safe = vm.envAddress("STOCK_DROPS_SAFE");
        require(safe.code.length > 0, "Safe required");
        uint256 owners = IStockDropSafe(safe).getOwners().length;
        uint256 threshold = IStockDropSafe(safe).getThreshold();
        require(owners >= 2 && threshold >= 2 && threshold <= owners, "invalid Safe policy");
        address[] memory tokens = new address[](4);
        tokens[0] = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
        tokens[1] = 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC;
        tokens[2] = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
        tokens[3] = 0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA;
        vm.startBroadcast();
        stockDrops = new MuppetStockDrops(safe, 0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189, tokens);
        vm.stopBroadcast();
        console2.log("Stock Drops", address(stockDrops));
        console2.log("Publisher Safe", safe);
        console2.log("Funded drops", stockDrops.nextDropId());
    }
}
