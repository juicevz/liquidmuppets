// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EZManagerPoolAdapter, IAggregatorV3Like} from "../src/adapters/EZManagerPoolAdapter.sol";
import {IEZWrapper, IUniswapV3PoolLike} from "../src/interfaces/IEZManager.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

contract EZManagerPoolAdapterForkTest is Test {
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    IEZWrapper private constant EZ_WRAPPER = IEZWrapper(0x6F81790Ebac25497be379Dc66143fb298663Ae11);
    IUniswapV3PoolLike private constant NVDA_USDG_POOL = IUniswapV3PoolLike(0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3);
    IAggregatorV3Like private constant NVDA_FEED = IAggregatorV3Like(0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15);

    address private depositor = makeAddr("reviewedRangeDepositor");

    function testForkOpensAndFullyExitsTheAllowlistedNvdaPool() public {
        if (block.chainid != 4663) return;

        EZManagerPoolAdapter adapter =
            new EZManagerPoolAdapter(USDG, EZ_WRAPPER, NVDA_USDG_POOL, NVDA_FEED, 1_200, 300, 3 days, 10e6);
        PolicyExecutor policy = new PolicyExecutor(address(this));
        StrategyVault vault =
            new StrategyVault(USDG, "LiquidMuppets NVDA Range", "mNVDA-RANGE", address(policy), adapter, 4, 2_500e6);
        policy.setFactory(address(this));
        policy.registerVault(address(vault), depositor, 6_000, 6_000, 6_000, 1 days, uint40(block.timestamp + 90 days));

        deal(address(USDG), depositor, 100e6, true);
        vm.startPrank(depositor);
        USDG.approve(address(vault), 100e6);
        uint256 shares = vault.deposit(100e6, depositor);
        vm.stopPrank();

        vm.prank(depositor);
        policy.executeAllocate(address(vault), 60e6);

        assertNotEq(adapter.positionKey(address(vault)), bytes32(0));
        assertGt(vault.deployedAssets(), 50e6);
        assertEq(vault.idleAssets(), 40e6);

        uint256 balanceBefore = USDG.balanceOf(depositor);
        vm.prank(depositor);
        uint256 redeemed = vault.redeem(shares, depositor, depositor);

        assertGt(redeemed, 90e6);
        assertEq(USDG.balanceOf(depositor) - balanceBefore, redeemed);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.totalAssets(), 0);
        assertEq(adapter.positionKey(address(vault)), bytes32(0));
    }
}
