// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IEZCore, IEZWrapper, IUniswapV3PoolLike} from "../interfaces/IEZManager.sol";

interface IAggregatorV3Like {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Holds one separately-accounted EZManager position per vault in an explicitly reviewed pool.
/// @dev Vault accounting stays in USDG. Pool entry and exit conversion is delegated to the allowlisted EZManager wrapper.
contract EZManagerPoolAdapter is IStrategyAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = 887272;

    IERC20 public immutable usdg;
    IEZWrapper public immutable wrapper;
    IEZCore public immutable core;
    IUniswapV3PoolLike public immutable pool;
    IAggregatorV3Like public immutable oracle;
    int24 public immutable tickSpacing;
    int24 public immutable halfRangeTicks;
    uint16 public immutable slippageBps;
    uint32 public immutable maxOracleAge;
    uint256 public immutable minimumOpenUsdg;

    mapping(address vault => bytes32 key) public positionKey;
    mapping(address vault => uint256 assets) public usdgCredit;

    event RangeOpened(address indexed vault, bytes32 indexed key, int24 tickLower, int24 tickUpper, uint256 usdgIn);
    event Deposited(address indexed vault, uint256 usdgIn, bytes32 indexed key);
    event Withdrawn(address indexed vault, uint256 requestedUsdg, uint256 returnedUsdg, bool positionClosed);

    error InvalidAddress();
    error InvalidConfig();
    error InvalidAmount();
    error InsufficientPosition();
    error OracleUnavailable();

    constructor(
        IERC20 usdg_,
        IEZWrapper wrapper_,
        IUniswapV3PoolLike pool_,
        IAggregatorV3Like oracle_,
        int24 halfRangeTicks_,
        uint16 slippageBps_,
        uint32 maxOracleAge_,
        uint256 minimumOpenUsdg_
    ) {
        if (
            address(usdg_).code.length == 0 || address(wrapper_).code.length == 0 || address(pool_).code.length == 0
                || address(oracle_).code.length == 0
        ) revert InvalidAddress();
        IEZCore core_ = wrapper_.CORE();
        if (
            address(core_).code.length == 0 || wrapper_.USDC() != usdg_ || core_.USDC() != usdg_
                || !core_.isPoolAllowed(address(pool_)) || core_.isPoolDeprecated(address(pool_))
        ) revert InvalidConfig();
        int24 spacing = pool_.tickSpacing();
        if (
            spacing <= 0 || halfRangeTicks_ < spacing * 10 || halfRangeTicks_ > 100_000
                || halfRangeTicks_ % spacing != 0 || slippageBps_ < 25 || slippageBps_ > 500
                || maxOracleAge_ < 5 minutes || maxOracleAge_ > 3 days || minimumOpenUsdg_ == 0
        ) revert InvalidConfig();

        usdg = usdg_;
        wrapper = wrapper_;
        core = core_;
        pool = pool_;
        oracle = oracle_;
        tickSpacing = spacing;
        halfRangeTicks = halfRangeTicks_;
        slippageBps = slippageBps_;
        maxOracleAge = maxOracleAge_;
        minimumOpenUsdg = minimumOpenUsdg_;
        usdg_.forceApprove(address(wrapper_), type(uint256).max);
    }

    function asset() external view returns (address) {
        return address(usdg);
    }

    function totalAssetsFor(address vault) public view returns (uint256) {
        uint256 assets = usdgCredit[vault];
        bytes32 key = positionKey[vault];
        if (key != bytes32(0)) assets += core.positionValueUSDCSingle(key);
        return assets;
    }

    function deposit(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        _checkMarket();
        uint256 beforeBalance = usdg.balanceOf(address(this));
        usdg.safeTransferFrom(msg.sender, address(this), assets);
        if (usdg.balanceOf(address(this)) - beforeBalance != assets) revert InvalidAmount();

        bytes32 key = positionKey[msg.sender];
        if (key == bytes32(0)) {
            if (assets < minimumOpenUsdg) revert InvalidAmount();
            (int24 lower, int24 upper) = currentRange();
            key = wrapper.ezOpen(address(pool), lower, upper, assets, slippageBps, address(0));
            positionKey[msg.sender] = key;
            emit RangeOpened(msg.sender, key, lower, upper, assets);
        } else {
            wrapper.ezAdd(key, assets, slippageBps);
        }
        emit Deposited(msg.sender, assets, key);
    }

    function withdraw(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 owned = totalAssetsFor(msg.sender);
        if (assets > owned) revert InsufficientPosition();
        if (assets == owned) {
            uint256 returned = usdgCredit[msg.sender];
            bytes32 fullKey = positionKey[msg.sender];
            if (fullKey != bytes32(0)) {
                returned += wrapper.ezExit(fullKey, slippageBps);
                delete positionKey[msg.sender];
            }
            delete usdgCredit[msg.sender];
            usdg.safeTransfer(msg.sender, returned);
            emit Withdrawn(msg.sender, assets, returned, true);
            return;
        }
        uint256 available = usdgCredit[msg.sender];
        bool closed;
        if (available < assets) {
            bytes32 key = positionKey[msg.sender];
            if (key == bytes32(0)) revert InsufficientPosition();
            uint256 missing = assets - available;
            uint256 positionAssets = core.positionValueUSDCSingle(key);
            if (missing + minimumOpenUsdg >= positionAssets) {
                available += wrapper.ezExit(key, slippageBps);
                delete positionKey[msg.sender];
                closed = true;
            } else {
                uint256 requested = Math.mulDiv(missing, BPS, BPS - slippageBps, Math.Rounding.Ceil);
                available += wrapper.ezRemove(key, requested, slippageBps);
            }
        }
        if (available < assets) revert InsufficientPosition();
        usdgCredit[msg.sender] = available - assets;
        usdg.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, assets, closed);
    }

    function currentRange() public view returns (int24 lower, int24 upper) {
        (, int24 currentTick,,,,,) = pool.slot0();
        lower = _boundTick(_floorTick(currentTick - halfRangeTicks));
        upper = _boundTick(_floorTick(currentTick + halfRangeTicks));
        if (upper <= lower) revert InvalidConfig();
    }

    function marketHealth()
        external
        view
        returns (bool allowed, bool deprecated, int256 oracleAnswer, uint256 oracleUpdatedAt, int24 currentTick)
    {
        allowed = core.isPoolAllowed(address(pool));
        deprecated = core.isPoolDeprecated(address(pool));
        (, oracleAnswer,, oracleUpdatedAt,) = oracle.latestRoundData();
        (, currentTick,,,,,) = pool.slot0();
    }

    function _checkMarket() private view {
        if (!core.isPoolAllowed(address(pool)) || core.isPoolDeprecated(address(pool))) revert InvalidConfig();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = oracle.latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || answeredInRound < roundId
                || block.timestamp - updatedAt > maxOracleAge
        ) revert OracleUnavailable();
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
