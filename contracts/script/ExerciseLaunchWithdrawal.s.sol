// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

/// @notice Exercises a small real withdrawal and restores the launch fixture to its prior funded state.
contract ExerciseLaunchWithdrawal is Script {
    uint256 private constant CHAIN_ID = 4663;
    uint256 private constant ROUND_TRIP_ASSETS = 0.0001 ether;
    StrategyVault private constant VAULT = StrategyVault(0x7F651Bdf03402D3125F90369aF8b018Ea5eFD363);
    IERC20 private constant WETH = IERC20(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(VAULT.balanceOf(deployer) >= VAULT.previewWithdraw(ROUND_TRIP_ASSETS), "insufficient shares");

        uint256 assetsBefore = VAULT.totalAssets();
        vm.startBroadcast(deployerKey);
        VAULT.withdraw(ROUND_TRIP_ASSETS, deployer, deployer);
        WETH.approve(address(VAULT), ROUND_TRIP_ASSETS);
        VAULT.deposit(ROUND_TRIP_ASSETS, deployer);
        vm.stopBroadcast();

        require(VAULT.totalAssets() == assetsBefore, "round trip changed vault assets");
        console2.log("vaultAssets", VAULT.totalAssets());
    }
}
