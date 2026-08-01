// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {LaunchReserveAdapter} from "../src/adapters/LaunchReserveAdapter.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

contract LaunchReserveAdapterTest is Test {
    MockERC20 private weth;
    LaunchReserveAdapter private adapter;
    PolicyExecutor private policy;
    StrategyVault private vault;

    address private depositor = makeAddr("launchDepositor");

    function setUp() public {
        weth = new MockERC20("Wrapped Ether", "WETH", 18, 0);
        adapter = new LaunchReserveAdapter(weth);
        policy = new PolicyExecutor(address(this));
        vault = new StrategyVault(weth, "Launch reserve", "mLAUNCH-TEST", address(policy), adapter, 2, 1 ether);
        weth.mint(depositor, 1 ether);
    }

    function testStagesOnlyTheBoundedAllocationAndRedeemsExactly() public {
        vm.startPrank(depositor);
        weth.approve(address(vault), 1 ether);
        uint256 shares = vault.deposit(1 ether, depositor);
        vm.stopPrank();

        vm.prank(address(policy));
        vault.allocateToAdapter(0.1 ether);

        assertEq(vault.idleAssets(), 0.9 ether);
        assertEq(vault.deployedAssets(), 0.1 ether);
        assertEq(adapter.reserveOf(address(vault)), 0.1 ether);

        vm.prank(depositor);
        uint256 assets = vault.redeem(shares, depositor, depositor);

        assertEq(assets, 1 ether);
        assertEq(weth.balanceOf(depositor), 1 ether);
        assertEq(adapter.reserveOf(address(vault)), 0);
        assertEq(vault.totalAssets(), 0);
    }

    function testOneVaultCannotWithdrawAnotherVaultReserve() public {
        StrategyVault other =
            new StrategyVault(weth, "Other reserve", "mLAUNCH-OTHER", address(policy), adapter, 2, 1 ether);
        weth.mint(address(vault), 0.1 ether);
        vm.prank(address(vault));
        weth.approve(address(adapter), 0.1 ether);
        vm.prank(address(vault));
        adapter.deposit(0.1 ether);

        vm.prank(address(other));
        vm.expectRevert(LaunchReserveAdapter.InsufficientReserve.selector);
        adapter.withdraw(1);
    }
}
