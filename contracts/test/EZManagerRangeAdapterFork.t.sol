// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EZManagerRangeAdapter} from "../src/adapters/EZManagerRangeAdapter.sol";
import {IEZWrapper, ISwapRouter02, IUniswapV3PoolLike} from "../src/interfaces/IEZManager.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {StrategyVault} from "../src/StrategyVault.sol";

contract EZManagerRangeAdapterForkTest is Test {
    IERC20 private constant WETH = IERC20(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IEZWrapper private constant EZ_WRAPPER = IEZWrapper(0x6F81790Ebac25497be379Dc66143fb298663Ae11);
    ISwapRouter02 private constant SWAP_ROUTER = ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);
    IUniswapV3PoolLike private constant WETH_USDG_POOL = IUniswapV3PoolLike(0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca);
    address private constant EZ_UNISWAP_ADAPTER = 0xbcAb6Cc4b2F1990F8e6e9f11C881a229D69CBb27;

    address private depositor = makeAddr("rangeDepositor");

    function testForkOpensRealRangeAndRedeemsToWeth() public {
        if (block.chainid != 4663) return;

        EZManagerRangeAdapter adapter = new EZManagerRangeAdapter(
            WETH, EZ_WRAPPER, SWAP_ROUTER, WETH_USDG_POOL, EZ_UNISWAP_ADAPTER, 1_200, 300, 1e6
        );
        PolicyExecutor policy = new PolicyExecutor(address(this));
        StrategyVault vault =
            new StrategyVault(WETH, "LiquidMuppets ETH Range", "mETH-RANGE", address(policy), adapter, 1, 1 ether);
        policy.setFactory(address(this));
        policy.registerVault(address(vault), depositor, 8_500, 8_500, 8_500, 6 hours, uint40(block.timestamp + 90 days));

        deal(address(WETH), depositor, 0.01 ether, true);
        vm.startPrank(depositor);
        WETH.approve(address(vault), 0.01 ether);
        uint256 shares = vault.deposit(0.01 ether, depositor);
        vm.stopPrank();

        vm.prank(depositor);
        policy.executeAllocate(address(vault), 0.0085 ether);

        assertNotEq(adapter.positionKey(address(vault)), bytes32(0));
        assertGt(vault.deployedAssets(), 0.008 ether);
        assertEq(vault.idleAssets(), 0.0015 ether);

        bytes32 firstPosition = adapter.positionKey(address(vault));
        vm.warp(block.timestamp + 1 days);
        vm.prank(depositor);
        (uint256 recalled, uint256 allocated) = policy.executeRecenter(address(vault));
        assertGt(recalled, 0.008 ether);
        assertGt(allocated, 0.008 ether);
        assertNotEq(adapter.positionKey(address(vault)), firstPosition);

        uint256 balanceBefore = WETH.balanceOf(depositor);
        vm.prank(depositor);
        uint256 redeemed = vault.redeem(shares, depositor, depositor);

        assertGt(redeemed, 0.009 ether);
        assertEq(WETH.balanceOf(depositor) - balanceBefore, redeemed);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.totalAssets(), 0);
        assertEq(adapter.positionKey(address(vault)), bytes32(0));
    }
}
