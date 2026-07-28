// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockYieldPool} from "../src/mocks/MockYieldPool.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        uint256 deploymentBlock = block.number;

        vm.startBroadcast(deployerKey);
        MockERC20 usdg = new MockERC20("LiquidMuppets Test USDG", "tUSDG", 6, 10_000e6);
        MockERC20 weth = new MockERC20("LiquidMuppets Test WETH", "tWETH", 18, 10 ether);
        MockYieldPool stablePool = new MockYieldPool(usdg);
        MockYieldPool ethPool = new MockYieldPool(weth);
        MockYieldPool launchPool = new MockYieldPool(usdg);
        PolicyExecutor policy = new PolicyExecutor(deployer);
        KeyMarketplace market = new KeyMarketplace(deployer, payable(deployer), 300);
        LiquidMuppetsFactory factory = new LiquidMuppetsFactory(deployer, policy, market);
        policy.setFactory(address(factory));
        policy.setKeeper(deployer, true);
        market.setFactory(address(factory));

        factory.setTaskConfig(
            0,
            LiquidMuppetsFactory.TaskConfig({
                asset: usdg,
                adapter: stablePool,
                sharePrefix: "mUSDG",
                maxSingleBps: 9_000,
                maxDailyBps: 9_000,
                maxAllocationBps: 9_000,
                cooldownSeconds: 5 minutes,
                depositCap: 1_000_000e6,
                enabled: true
            })
        );
        factory.setTaskConfig(
            1,
            LiquidMuppetsFactory.TaskConfig({
                asset: weth,
                adapter: ethPool,
                sharePrefix: "mETH",
                maxSingleBps: 8_500,
                maxDailyBps: 8_500,
                maxAllocationBps: 8_500,
                cooldownSeconds: 5 minutes,
                depositCap: 1_000 ether,
                enabled: true
            })
        );
        factory.setTaskConfig(
            2,
            LiquidMuppetsFactory.TaskConfig({
                asset: usdg,
                adapter: launchPool,
                sharePrefix: "mUSDG",
                maxSingleBps: 1_000,
                maxDailyBps: 2_000,
                maxAllocationBps: 5_000,
                cooldownSeconds: 10 minutes,
                depositCap: 1_000_000e6,
                enabled: true
            })
        );
        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("factory", address(factory));
        console2.log("policyExecutor", address(policy));
        console2.log("keyMarketplace", address(market));
        console2.log("testUSDG", address(usdg));
        console2.log("testWETH", address(weth));
        console2.log("stablePool", address(stablePool));
        console2.log("ethPool", address(ethPool));
        console2.log("launchPool", address(launchPool));

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", deploymentBlock);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "factory", address(factory));
        vm.serializeAddress(root, "policyExecutor", address(policy));
        vm.serializeAddress(root, "keyMarketplace", address(market));
        vm.serializeAddress(root, "testUSDG", address(usdg));
        vm.serializeAddress(root, "testWETH", address(weth));
        vm.serializeAddress(root, "stablePool", address(stablePool));
        vm.serializeAddress(root, "ethPool", address(ethPool));
        string memory json = vm.serializeAddress(root, "launchPool", address(launchPool));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/robinhood-testnet.json"));
    }
}
