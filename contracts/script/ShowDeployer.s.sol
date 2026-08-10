// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";

contract ShowDeployer is Script {
    function run() external view {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        console2.log("deployer", vm.addr(deployerKey));
    }
}
