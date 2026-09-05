// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IEZValuation, ISwapRouter02} from "./interfaces/IEZManager.sol";

interface IWrappedNative is IERC20 {
    function deposit() external payable;
}

interface IStockToken is IERC20Metadata {
    function oraclePaused() external view returns (bool);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3LiquidityLike {
    function liquidity() external view returns (uint128);
}

/// @notice Receives Key marketplace fees and rotates them through reviewed Robinhood Stock Token routes.
/// @dev Routes are direct USDG pools and every purchase is bounded by independent WETH and Stock Token prices.
contract FeeRwaReserve is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_ROUTES = 64;

    struct Route {
        address token;
        address feed;
        address pool;
        uint24 poolFee;
        uint32 maxOracleAge;
        bool enabled;
    }

    struct RouteInput {
        address token;
        address feed;
        uint24 poolFee;
        uint32 maxOracleAge;
        bool enabled;
    }

    IWrappedNative public immutable WETH;
    IERC20 public immutable USDG;
    ISwapRouter02 public immutable SWAP_ROUTER;
    IUniswapV3FactoryLike public immutable UNISWAP_FACTORY;
    IEZValuation public immutable WETH_VALUATION;
    address public immutable WETH_VALUATION_DEX;
    address public immutable FEE_SOURCE;

    Route[] private routes;
    mapping(address token => uint256 indexPlusOne) public routeIndex;
    mapping(address keeper => bool allowed) public keepers;

    uint256 public minimumCycleWei;
    uint256 public maximumCycleWei;
    uint32 public cooldownSeconds;
    uint16 public slippageBps;
    uint40 public lastCycleAt;
    uint32 public nextRouteIndex;
    uint256 public purchaseCount;
    uint256 public totalNativeSpent;
    uint256 public totalUsdgSpent;
    uint256 public totalFeesReceived;
    bool public paused;

    event MarketplaceFeesReceived(address indexed source, uint256 amount);
    event ReserveFunded(address indexed sender, uint256 amount);
    event KeeperSet(address indexed keeper, bool allowed);
    event RouteSet(
        uint256 indexed index,
        address indexed token,
        address indexed feed,
        address pool,
        uint24 poolFee,
        uint32 maxOracleAge,
        bool enabled
    );
    event LimitsSet(uint256 minimumCycleWei, uint256 maximumCycleWei, uint32 cooldownSeconds, uint16 slippageBps);
    event PausedSet(bool paused);
    event StockTokenPurchased(
        uint256 indexed purchaseId,
        uint256 indexed routeIndex,
        address indexed token,
        uint256 nativeSpent,
        uint256 usdgSpent,
        uint256 tokenReceived
    );
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);
    event NativeRescued(address indexed receiver, uint256 amount);

    error OnlyKeeper();
    error InvalidAddress();
    error InvalidAsset();
    error InvalidLimits();
    error InvalidRoute();
    error TooManyRoutes();
    error ReservePaused();
    error ReserveNotPaused();
    error CycleTooSmall();
    error CycleTooLarge();
    error InsufficientNativeBalance();
    error CooldownActive();
    error NoUsableRoute();
    error MissingValuation();
    error PaymentFailed();

    modifier onlyKeeper() {
        if (!keepers[msg.sender] && msg.sender != owner()) revert OnlyKeeper();
        _;
    }

    constructor(
        address initialOwner,
        address feeSource,
        IWrappedNative weth,
        IERC20 usdg,
        ISwapRouter02 swapRouter,
        IUniswapV3FactoryLike uniswapFactory,
        IEZValuation wethValuation,
        address wethValuationDex,
        uint256 minimumCycleWei_,
        uint256 maximumCycleWei_,
        uint32 cooldownSeconds_,
        uint16 slippageBps_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || feeSource == address(0) || address(weth) == address(0)
                || address(usdg) == address(0) || address(swapRouter) == address(0)
                || address(uniswapFactory) == address(0) || address(wethValuation) == address(0)
                || wethValuationDex == address(0)
        ) revert InvalidAddress();
        if (IERC20Metadata(address(weth)).decimals() != 18 || IERC20Metadata(address(usdg)).decimals() != 6) {
            revert InvalidAsset();
        }

        FEE_SOURCE = feeSource;
        WETH = weth;
        USDG = usdg;
        SWAP_ROUTER = swapRouter;
        UNISWAP_FACTORY = uniswapFactory;
        WETH_VALUATION = wethValuation;
        WETH_VALUATION_DEX = wethValuationDex;
        _setLimits(minimumCycleWei_, maximumCycleWei_, cooldownSeconds_, slippageBps_);
    }

    receive() external payable {
        if (msg.sender == FEE_SOURCE) {
            totalFeesReceived += msg.value;
            emit MarketplaceFeesReceived(msg.sender, msg.value);
        } else {
            emit ReserveFunded(msg.sender, msg.value);
        }
    }

    function fund() external payable {
        emit ReserveFunded(msg.sender, msg.value);
    }

    function routeCount() external view returns (uint256) {
        return routes.length;
    }

    function routeAt(uint256 index) external view returns (Route memory) {
        return routes[index];
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert InvalidAddress();
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setRoutes(RouteInput[] calldata nextRoutes) external onlyOwner {
        for (uint256 index; index < nextRoutes.length; ++index) {
            _setRoute(nextRoutes[index]);
        }
    }

    function setLimits(uint256 minimumCycleWei_, uint256 maximumCycleWei_, uint32 cooldownSeconds_, uint16 slippageBps_)
        external
        onlyOwner
    {
        _setLimits(minimumCycleWei_, maximumCycleWei_, cooldownSeconds_, slippageBps_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function availableCycleAmount() public view returns (uint256 amount) {
        amount = address(this).balance;
        if (amount > maximumCycleWei) amount = maximumCycleWei;
        if (amount < minimumCycleWei) return 0;
    }

    function nextUsableRoute() public view returns (uint256 index, uint256 price, uint256 updatedAt) {
        uint256 count = routes.length;
        if (count == 0) revert NoUsableRoute();
        uint256 start = uint256(nextRouteIndex) % count;
        for (uint256 offset; offset < count; ++offset) {
            index = (start + offset) % count;
            (bool usable, uint256 routePrice, uint256 routeUpdatedAt) = _routeState(routes[index]);
            if (usable) return (index, routePrice, routeUpdatedAt);
        }
        revert NoUsableRoute();
    }

    function executeAvailableCycle()
        external
        onlyKeeper
        nonReentrant
        returns (uint256 routeIndex_, uint256 usdgSpent, uint256 tokenReceived)
    {
        uint256 amount = availableCycleAmount();
        if (amount == 0) revert CycleTooSmall();
        return _executeCycle(amount);
    }

    function executeCycle(uint256 nativeAmount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 routeIndex_, uint256 usdgSpent, uint256 tokenReceived)
    {
        return _executeCycle(nativeAmount);
    }

    function rescueToken(IERC20 token, address receiver, uint256 amount) external onlyOwner nonReentrant {
        if (!paused) revert ReserveNotPaused();
        if (receiver == address(0)) revert InvalidAddress();
        token.safeTransfer(receiver, amount);
        emit TokenRescued(address(token), receiver, amount);
    }

    function rescueNative(address payable receiver, uint256 amount) external onlyOwner nonReentrant {
        if (!paused) revert ReserveNotPaused();
        if (receiver == address(0)) revert InvalidAddress();
        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert PaymentFailed();
        emit NativeRescued(receiver, amount);
    }

    function _setRoute(RouteInput calldata nextRoute) private {
        if (
            nextRoute.token == address(0) || nextRoute.feed == address(0) || nextRoute.poolFee == 0
                || nextRoute.maxOracleAge < 1 hours || nextRoute.maxOracleAge > 7 days
        ) revert InvalidRoute();
        if (nextRoute.token.code.length == 0 || nextRoute.feed.code.length == 0) revert InvalidRoute();
        if (IERC20Metadata(nextRoute.token).decimals() != 18 || IAggregatorV3(nextRoute.feed).decimals() > 18) {
            revert InvalidAsset();
        }
        address pool = UNISWAP_FACTORY.getPool(address(USDG), nextRoute.token, nextRoute.poolFee);
        if (pool == address(0) || pool.code.length == 0 || IUniswapV3LiquidityLike(pool).liquidity() == 0) {
            revert InvalidRoute();
        }

        uint256 indexPlusOne = routeIndex[nextRoute.token];
        uint256 index;
        if (indexPlusOne == 0) {
            if (routes.length >= MAX_ROUTES) revert TooManyRoutes();
            index = routes.length;
            routes.push();
            routeIndex[nextRoute.token] = index + 1;
        } else {
            index = indexPlusOne - 1;
        }
        routes[index] = Route({
            token: nextRoute.token,
            feed: nextRoute.feed,
            pool: pool,
            poolFee: nextRoute.poolFee,
            maxOracleAge: nextRoute.maxOracleAge,
            enabled: nextRoute.enabled
        });
        emit RouteSet(
            index, nextRoute.token, nextRoute.feed, pool, nextRoute.poolFee, nextRoute.maxOracleAge, nextRoute.enabled
        );
    }

    function _setLimits(
        uint256 minimumCycleWei_,
        uint256 maximumCycleWei_,
        uint32 cooldownSeconds_,
        uint16 slippageBps_
    ) private {
        if (
            minimumCycleWei_ == 0 || maximumCycleWei_ < minimumCycleWei_ || cooldownSeconds_ > 7 days
                || slippageBps_ > 1_000
        ) revert InvalidLimits();
        minimumCycleWei = minimumCycleWei_;
        maximumCycleWei = maximumCycleWei_;
        cooldownSeconds = cooldownSeconds_;
        slippageBps = slippageBps_;
        emit LimitsSet(minimumCycleWei_, maximumCycleWei_, cooldownSeconds_, slippageBps_);
    }

    function _executeCycle(uint256 nativeAmount)
        private
        returns (uint256 routeIndex_, uint256 usdgSpent, uint256 tokenReceived)
    {
        if (paused) revert ReservePaused();
        if (nativeAmount < minimumCycleWei) revert CycleTooSmall();
        if (nativeAmount > maximumCycleWei) revert CycleTooLarge();
        if (nativeAmount > address(this).balance) revert InsufficientNativeBalance();
        if (lastCycleAt != 0 && block.timestamp < uint256(lastCycleAt) + cooldownSeconds) revert CooldownActive();

        uint256 price;
        (routeIndex_, price,) = nextUsableRoute();
        Route memory route = routes[routeIndex_];

        lastCycleAt = uint40(block.timestamp);
        nextRouteIndex = uint32((routeIndex_ + 1) % routes.length);
        totalNativeSpent += nativeAmount;

        WETH.deposit{value: nativeAmount}();
        IERC20(address(WETH)).forceApprove(address(SWAP_ROUTER), nativeAmount);
        uint256 expectedUsdg = WETH_VALUATION.usdcValue(WETH_VALUATION_DEX, address(WETH), nativeAmount);
        if (expectedUsdg == 0) revert MissingValuation();
        uint256 usdgBefore = USDG.balanceOf(address(this));
        SWAP_ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: address(USDG),
                fee: 100,
                recipient: address(this),
                amountIn: nativeAmount,
                amountOutMinimum: Math.mulDiv(expectedUsdg, BPS - slippageBps, BPS),
                sqrtPriceLimitX96: 0
            })
        );
        usdgSpent = USDG.balanceOf(address(this)) - usdgBefore;

        uint8 feedDecimals = IAggregatorV3(route.feed).decimals();
        uint256 expectedStock = Math.mulDiv(usdgSpent, 10 ** (12 + feedDecimals), price);
        uint256 minimumStock = Math.mulDiv(expectedStock, BPS - slippageBps, BPS);
        USDG.forceApprove(address(SWAP_ROUTER), usdgSpent);
        uint256 tokenBefore = IERC20(route.token).balanceOf(address(this));
        SWAP_ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(USDG),
                tokenOut: route.token,
                fee: route.poolFee,
                recipient: address(this),
                amountIn: usdgSpent,
                amountOutMinimum: minimumStock,
                sqrtPriceLimitX96: 0
            })
        );
        tokenReceived = IERC20(route.token).balanceOf(address(this)) - tokenBefore;

        totalUsdgSpent += usdgSpent;
        ++purchaseCount;
        emit StockTokenPurchased(purchaseCount, routeIndex_, route.token, nativeAmount, usdgSpent, tokenReceived);
    }

    function _routeState(Route memory route) private view returns (bool usable, uint256 price, uint256 updatedAt) {
        if (!route.enabled) return (false, 0, 0);
        try IStockToken(route.token).oraclePaused() returns (bool oraclePaused) {
            if (oraclePaused) return (false, 0, 0);
        } catch {
            return (false, 0, 0);
        }
        try IUniswapV3LiquidityLike(route.pool).liquidity() returns (uint128 liquidity) {
            if (liquidity == 0) return (false, 0, 0);
        } catch {
            return (false, 0, 0);
        }
        try IAggregatorV3(route.feed).latestRoundData() returns (
            uint80 roundId, int256 answer, uint256, uint256 feedUpdatedAt, uint80 answeredInRound
        ) {
            if (
                answer <= 0 || feedUpdatedAt == 0 || feedUpdatedAt > block.timestamp || answeredInRound < roundId
                    || block.timestamp - feedUpdatedAt > route.maxOracleAge
            ) return (false, 0, 0);
            return (true, uint256(answer), feedUpdatedAt);
        } catch {
            return (false, 0, 0);
        }
    }
}
