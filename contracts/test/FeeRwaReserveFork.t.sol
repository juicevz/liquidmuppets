// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FeeRwaReserve, IWrappedNative, IUniswapV3FactoryLike} from "../src/FeeRwaReserve.sol";
import {IEZValuation, ISwapRouter02} from "../src/interfaces/IEZManager.sol";

contract FeeRwaReserveForkTest is Test {
    address private constant MARKETPLACE = 0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb;
    IWrappedNative private constant WETH = IWrappedNative(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    ISwapRouter02 private constant ROUTER = ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);
    IUniswapV3FactoryLike private constant UNISWAP_FACTORY =
        IUniswapV3FactoryLike(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA);
    IEZValuation private constant VALUATION = IEZValuation(0x3A5e783c9E7B24505d0baee021D555e81EA86E79);
    address private constant VALUATION_DEX = 0xbcAb6Cc4b2F1990F8e6e9f11C881a229D69CBb27;
    IERC20 private constant AAPL = IERC20(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9);
    address private constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;

    address private keeper = makeAddr("rwaKeeper");

    function testForkBuysOracleBoundStockTokenThroughLivePools() public {
        if (block.chainid != 4663) return;

        FeeRwaReserve reserve = new FeeRwaReserve(
            address(this),
            MARKETPLACE,
            WETH,
            USDG,
            ROUTER,
            UNISWAP_FACTORY,
            VALUATION,
            VALUATION_DEX,
            0.0001 ether,
            0.01 ether,
            1 hours,
            300
        );
        reserve.setKeeper(keeper, true);
        FeeRwaReserve.RouteInput[] memory routes = new FeeRwaReserve.RouteInput[](1);
        routes[0] = FeeRwaReserve.RouteInput({
            token: address(AAPL), feed: AAPL_FEED, poolFee: 500, maxOracleAge: 3 days, enabled: true
        });
        reserve.setRoutes(routes);
        vm.deal(address(reserve), 0.001 ether);

        vm.prank(keeper);
        (uint256 routeIndex, uint256 usdgSpent, uint256 received) = reserve.executeAvailableCycle();

        assertEq(routeIndex, 0);
        assertGt(usdgSpent, 0);
        assertGt(received, 0);
        assertEq(AAPL.balanceOf(address(reserve)), received);
        assertEq(reserve.purchaseCount(), 1);
        assertEq(reserve.totalNativeSpent(), 0.001 ether);
        assertEq(address(reserve).balance, 0);
    }

    function testForkSkipsAPausedRouteAndRotatesToNextUsableRoute() public {
        if (block.chainid != 4663) return;

        FeeRwaReserve reserve = new FeeRwaReserve(
            address(this),
            MARKETPLACE,
            WETH,
            USDG,
            ROUTER,
            UNISWAP_FACTORY,
            VALUATION,
            VALUATION_DEX,
            0.0001 ether,
            0.01 ether,
            0,
            300
        );
        FeeRwaReserve.RouteInput[] memory routes = new FeeRwaReserve.RouteInput[](2);
        routes[0] = FeeRwaReserve.RouteInput({
            token: address(AAPL), feed: AAPL_FEED, poolFee: 500, maxOracleAge: 3 days, enabled: false
        });
        routes[1] = FeeRwaReserve.RouteInput({
            token: 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,
            feed: 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15,
            poolFee: 500,
            maxOracleAge: 3 days,
            enabled: true
        });
        reserve.setRoutes(routes);

        (uint256 routeIndex,,) = reserve.nextUsableRoute();
        assertEq(routeIndex, 1);
    }
}
