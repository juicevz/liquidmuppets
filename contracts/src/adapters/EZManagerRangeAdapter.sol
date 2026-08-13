// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IEZCore, IEZValuation, IEZWrapper, ISwapRouter02, IUniswapV3PoolLike} from "../interfaces/IEZManager.sol";

/// @notice Converts WETH into a separately-accounted EZManager WETH/USDG range for each calling vault.
/// @dev EZManager owns the V3 NFT. Its wrapper maps each position key back to this adapter.
contract EZManagerRangeAdapter is IStrategyAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = 887272;

    IERC20 public immutable weth;
    IERC20 public immutable usdg;
    IEZWrapper public immutable wrapper;
    IEZCore public immutable core;
    IEZValuation public immutable valuation;
    ISwapRouter02 public immutable router;
    IUniswapV3PoolLike public immutable pool;
    address public immutable dexAdapter;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    int24 public immutable halfRangeTicks;
    uint16 public immutable slippageBps;
    uint256 public immutable minimumOpenUsdg;

    mapping(address vault => bytes32 key) public positionKey;
    mapping(address vault => uint256 assets) public wethCredit;
    mapping(address vault => uint256 assets) public usdgCredit;

    event RangeOpened(address indexed vault, bytes32 indexed key, int24 tickLower, int24 tickUpper, uint256 usdgIn);
    event Deposited(address indexed vault, uint256 wethIn, uint256 usdgIn, bytes32 indexed key);
    event Withdrawn(address indexed vault, uint256 requestedWeth, uint256 returnedWeth, bool positionClosed);

    error InvalidAddress();
    error InvalidPool();
    error InvalidConfig();
    error InvalidAmount();
    error InsufficientPosition();
    error SwapOutputTooLow();

    constructor(
        IERC20 weth_,
        IEZWrapper wrapper_,
        ISwapRouter02 router_,
        IUniswapV3PoolLike pool_,
        address dexAdapter_,
        int24 halfRangeTicks_,
        uint16 slippageBps_,
        uint256 minimumOpenUsdg_
    ) {
        if (
            address(weth_).code.length == 0 || address(wrapper_).code.length == 0 || address(router_).code.length == 0
                || address(pool_).code.length == 0 || dexAdapter_.code.length == 0
        ) revert InvalidAddress();
        IEZCore core_ = wrapper_.CORE();
        IERC20 usdg_ = wrapper_.USDC();
        if (
            address(core_).code.length == 0 || address(usdg_).code.length == 0 || core_.USDC() != usdg_
                || !core_.isPoolAllowed(address(pool_)) || core_.isPoolDeprecated(address(pool_))
                || !core_.allowedDexes(dexAdapter_)
        ) revert InvalidConfig();
        address token0 = pool_.token0();
        address token1 = pool_.token1();
        if (!((token0 == address(weth_) && token1 == address(usdg_))
                    || (token1 == address(weth_) && token0 == address(usdg_)))) revert InvalidPool();
        int24 spacing = pool_.tickSpacing();
        if (
            spacing <= 0 || halfRangeTicks_ < spacing * 10 || halfRangeTicks_ > 100_000
                || halfRangeTicks_ % spacing != 0 || slippageBps_ < 25 || slippageBps_ > 500 || minimumOpenUsdg_ == 0
        ) revert InvalidConfig();

        weth = weth_;
        usdg = usdg_;
        wrapper = wrapper_;
        core = core_;
        valuation = core_.VALUATION();
        router = router_;
        pool = pool_;
        dexAdapter = dexAdapter_;
        poolFee = pool_.fee();
        tickSpacing = spacing;
        halfRangeTicks = halfRangeTicks_;
        slippageBps = slippageBps_;
        minimumOpenUsdg = minimumOpenUsdg_;

        weth_.forceApprove(address(router_), type(uint256).max);
        usdg_.forceApprove(address(router_), type(uint256).max);
        usdg_.forceApprove(address(wrapper_), type(uint256).max);
    }

    function asset() external view returns (address) {
        return address(weth);
    }

    function totalAssetsFor(address vault) public view returns (uint256) {
        uint256 assets = wethCredit[vault] + _usdgToWeth(usdgCredit[vault]);
        bytes32 key = positionKey[vault];
        if (key != bytes32(0)) assets += _usdgToWeth(core.positionValueUSDCSingle(key));
        return assets;
    }

    function deposit(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 beforeBalance = weth.balanceOf(address(this));
        weth.safeTransferFrom(msg.sender, address(this), assets);
        if (weth.balanceOf(address(this)) - beforeBalance != assets) revert InvalidAmount();

        uint256 usdgIn = _swapWethToUsdg(assets);
        bytes32 key = positionKey[msg.sender];
        if (key == bytes32(0)) {
            if (usdgIn < minimumOpenUsdg) revert InvalidAmount();
            (int24 lower, int24 upper) = currentRange();
            key = wrapper.ezOpen(address(pool), lower, upper, usdgIn, slippageBps, address(0));
            positionKey[msg.sender] = key;
            emit RangeOpened(msg.sender, key, lower, upper, usdgIn);
        } else {
            wrapper.ezAdd(key, usdgIn, slippageBps);
        }
        emit Deposited(msg.sender, assets, usdgIn, key);
    }

    function withdraw(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 owned = totalAssetsFor(msg.sender);
        if (assets > owned) revert InsufficientPosition();
        if (assets == owned) {
            uint256 returned = _exitAll(msg.sender);
            emit Withdrawn(msg.sender, assets, returned, true);
            return;
        }

        _materializeWeth(msg.sender, assets);
        uint256 available = wethCredit[msg.sender];
        if (available < assets) revert SwapOutputTooLow();
        wethCredit[msg.sender] = available - assets;
        weth.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, assets, positionKey[msg.sender] == bytes32(0));
    }

    function currentRange() public view returns (int24 lower, int24 upper) {
        (, int24 currentTick,,,,,) = pool.slot0();
        lower = _boundTick(_floorTick(currentTick - halfRangeTicks));
        upper = _boundTick(_floorTick(currentTick + halfRangeTicks));
        if (upper <= lower) revert InvalidConfig();
    }

    function wethPriceUsdg() public view returns (uint256) {
        uint256 value = valuation.usdcValue(dexAdapter, address(weth), 1 ether);
        if (value == 0) revert InvalidConfig();
        return value;
    }

    function _materializeWeth(address vault, uint256 targetWeth) private {
        uint256 available = wethCredit[vault];
        if (available >= targetWeth) return;
        bytes32 key = positionKey[vault];
        if (key == bytes32(0)) revert InsufficientPosition();

        uint256 missing = targetWeth - available;
        uint256 requestedUsdg = Math.mulDiv(_wethToUsdg(missing), BPS, BPS - slippageBps, Math.Rounding.Ceil);
        uint256 positionUsdg = core.positionValueUSDCSingle(key);
        if (requestedUsdg + minimumOpenUsdg >= positionUsdg) {
            _closePositionToCredits(vault);
        } else {
            usdgCredit[vault] += wrapper.ezRemove(key, requestedUsdg, slippageBps);
        }
        _convertUsdgCredit(vault);
    }

    function _exitAll(address vault) private returns (uint256 returned) {
        _closePositionToCredits(vault);
        _convertUsdgCredit(vault);
        returned = wethCredit[vault];
        wethCredit[vault] = 0;
        weth.safeTransfer(vault, returned);
    }

    function _closePositionToCredits(address vault) private {
        bytes32 key = positionKey[vault];
        if (key == bytes32(0)) return;
        usdgCredit[vault] += wrapper.ezExit(key, slippageBps);
        delete positionKey[vault];
    }

    function _convertUsdgCredit(address vault) private {
        uint256 amount = usdgCredit[vault];
        if (amount == 0) return;
        usdgCredit[vault] = 0;
        wethCredit[vault] += _swapUsdgToWeth(amount);
    }

    function _swapWethToUsdg(uint256 amount) private returns (uint256 output) {
        uint256 minimum = Math.mulDiv(_wethToUsdg(amount), BPS - slippageBps, BPS);
        output = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(weth),
                tokenOut: address(usdg),
                fee: poolFee,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: minimum,
                sqrtPriceLimitX96: 0
            })
        );
        if (output < minimum) revert SwapOutputTooLow();
    }

    function _swapUsdgToWeth(uint256 amount) private returns (uint256 output) {
        uint256 minimum = Math.mulDiv(_usdgToWeth(amount), BPS - slippageBps, BPS);
        output = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(weth),
                fee: poolFee,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: minimum,
                sqrtPriceLimitX96: 0
            })
        );
        if (output < minimum) revert SwapOutputTooLow();
    }

    function _wethToUsdg(uint256 amount) private view returns (uint256) {
        return Math.mulDiv(amount, wethPriceUsdg(), 1 ether);
    }

    function _usdgToWeth(uint256 amount) private view returns (uint256) {
        if (amount == 0) return 0;
        return Math.mulDiv(amount, 1 ether, wethPriceUsdg());
    }

    function _floorTick(int24 tick) private view returns (int24) {
        int24 compressed = tick / tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) compressed -= 1;
        return compressed * tickSpacing;
    }

    function _boundTick(int24 tick) private view returns (int24) {
        int24 minimum = _floorTick(MIN_TICK) + tickSpacing;
        int24 maximum = _floorTick(MAX_TICK);
        if (tick < minimum) return minimum;
        if (tick > maximum) return maximum;
        return tick;
    }
}
