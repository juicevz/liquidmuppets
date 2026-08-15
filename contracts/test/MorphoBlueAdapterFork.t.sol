// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MorphoBlueAdapter} from "../src/adapters/MorphoBlueAdapter.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

contract MorphoBlueAdapterForkTest is Test {
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    IMorpho private constant MORPHO = IMorpho(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010);
    address private constant USDE = 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34;
    address private constant ORACLE = 0xE64849bd4AD03DfaBbe02bb521de19997a19055f;
    address private constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;

    address private creator = makeAddr("forkCreator");
    address private depositor = makeAddr("forkDepositor");
    address private secondDepositor = makeAddr("secondForkDepositor");

    function testForkSuppliesAccruesAndRedeemsRealUSDG() public {
        if (block.chainid != 4663) return;

        MarketParams memory params =
            MarketParams({loanToken: address(USDG), collateralToken: USDE, oracle: ORACLE, irm: IRM, lltv: 915e15});
        MorphoBlueAdapter adapter = new MorphoBlueAdapter(MORPHO, params, 10_000_000e6, 9_500);
        PolicyExecutor policy = new PolicyExecutor(address(this));
        StrategyVault vault =
            new StrategyVault(USDG, "LiquidMuppets Fork Vault", "mUSDG-FORK", address(policy), adapter, 0, 10_000e6);

        deal(address(USDG), depositor, 1_000e6, true);
        vm.startPrank(depositor);
        USDG.approve(address(vault), 1_000e6);
        uint256 shares = vault.deposit(1_000e6, depositor);
        vm.stopPrank();

        vm.prank(address(policy));
        vault.allocateToAdapter(900e6);
        assertApproxEqAbs(vault.deployedAssets(), 900e6, 2);
        assertApproxEqAbs(vault.totalAssets(), 1_000e6, 2);
        assertEq(vault.decimals(), 18);
        assertGt(shares, 0);

        vm.warp(block.timestamp + 1 days);
        assertGt(vault.totalAssets(), 1_000e6);

        uint256 depositorShares = vault.balanceOf(depositor);
        vm.prank(depositor);
        uint256 redeemed = vault.redeem(depositorShares, depositor, depositor);
        assertGt(redeemed, 1_000e6);
        assertEq(vault.totalSupply(), 0);
    }

    function testForkKeepsSharedAdapterPositionsIsolated() public {
        if (block.chainid != 4663) return;

        MarketParams memory params =
            MarketParams({loanToken: address(USDG), collateralToken: USDE, oracle: ORACLE, irm: IRM, lltv: 915e15});
        MorphoBlueAdapter adapter = new MorphoBlueAdapter(MORPHO, params, 10_000_000e6, 9_500);
        PolicyExecutor policy = new PolicyExecutor(address(this));
        StrategyVault first =
            new StrategyVault(USDG, "First Fork Vault", "mUSDG-ONE", address(policy), adapter, 0, 10_000e6);
        StrategyVault second =
            new StrategyVault(USDG, "Second Fork Vault", "mUSDG-TWO", address(policy), adapter, 0, 10_000e6);

        deal(address(USDG), depositor, 600e6, true);
        deal(address(USDG), secondDepositor, 400e6, true);
        vm.startPrank(depositor);
        USDG.approve(address(first), 600e6);
        first.deposit(600e6, depositor);
        vm.stopPrank();
        vm.startPrank(secondDepositor);
        USDG.approve(address(second), 400e6);
        second.deposit(400e6, secondDepositor);
        vm.stopPrank();

        vm.startPrank(address(policy));
        first.allocateToAdapter(500e6);
        second.allocateToAdapter(300e6);
        vm.stopPrank();

        uint256 secondPositionBefore = second.deployedAssets();
        uint256 firstDepositorShares = first.balanceOf(depositor);
        vm.prank(depositor);
        first.redeem(firstDepositorShares, depositor, depositor);

        assertEq(first.totalSupply(), 0);
        assertApproxEqAbs(second.deployedAssets(), secondPositionBefore, 2);
        assertEq(adapter.totalTrackedShares(), adapter.positionShares(address(second)));
    }
}
