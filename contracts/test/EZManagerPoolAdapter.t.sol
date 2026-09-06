// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {EZManagerPoolAdapter, IAggregatorV3Like} from "../src/adapters/EZManagerPoolAdapter.sol";
import {IEZCore, IEZValuation, IEZWrapper, IUniswapV3PoolLike} from "../src/interfaces/IEZManager.sol";

contract MockReviewedPool is IUniswapV3PoolLike {
    address public immutable token0;
    address public immutable token1;
    int24 public immutable tickSpacing = 10;
    int24 public tick;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function fee() external pure returns (uint24) {
        return 500;
    }

    function setTick(int24 tick_) external {
        tick = tick_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (1, tick, 0, 1, 1, 0, true);
    }
}

contract MockReviewedOracle is IAggregatorV3Like {
    int256 public answer = 100e8;
    uint256 public updatedAt;

    constructor() {
        updatedAt = block.timestamp;
    }

    function setRound(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockReviewedCore is IEZCore {
    IERC20 public immutable override USDC;
    mapping(address => bool) public allowed;
    mapping(address => bool) public deprecated;
    mapping(bytes32 => uint256) public values;

    constructor(IERC20 usdg) {
        USDC = usdg;
    }

    function VALUATION() external pure returns (IEZValuation) {
        return IEZValuation(address(0));
    }

    function isPoolAllowed(address pool) external view returns (bool) {
        return allowed[pool];
    }

    function isPoolDeprecated(address pool) external view returns (bool) {
        return deprecated[pool];
    }

    function allowedDexes(address) external pure returns (bool) {
        return true;
    }

    function positionValueUSDCSingle(bytes32 key) external view returns (uint256) {
        return values[key];
    }

    function setAllowed(address pool, bool value) external {
        allowed[pool] = value;
    }

    function setDeprecated(address pool, bool value) external {
        deprecated[pool] = value;
    }

    function setValue(bytes32 key, uint256 value) external {
        values[key] = value;
    }
}

    contract MockReviewedWrapper is IEZWrapper {
        IEZCore public immutable override CORE;
        IERC20 public immutable override USDC;
        MockReviewedCore private immutable core;
        uint256 private nonce;

        constructor(MockReviewedCore core_) {
            core = core_;
            CORE = core_;
            USDC = core_.USDC();
        }

        function ezOpen(address, int24, int24, uint256 usdcAmount, uint256, address) external returns (bytes32 key) {
            USDC.transferFrom(msg.sender, address(this), usdcAmount);
            key = keccak256(abi.encode(msg.sender, ++nonce));
            core.setValue(key, usdcAmount);
        }

        function ezAdd(bytes32 key, uint256 usdcAmount, uint256) external {
            USDC.transferFrom(msg.sender, address(this), usdcAmount);
            core.setValue(key, core.values(key) + usdcAmount);
        }

        function ezRemove(bytes32 key, uint256 withdrawUsdc, uint256) external returns (uint256 returnedUsdc) {
            uint256 value = core.values(key);
            returnedUsdc = withdrawUsdc > value ? value : withdrawUsdc;
            core.setValue(key, value - returnedUsdc);
            USDC.transfer(msg.sender, returnedUsdc);
        }

        function ezExit(bytes32 key, uint256) external returns (uint256 returnedUsdc) {
            returnedUsdc = core.values(key);
            core.setValue(key, 0);
            USDC.transfer(msg.sender, returnedUsdc);
        }
    }

        contract EZManagerPoolAdapterTest is Test {
            MockERC20 internal usdg;
            MockERC20 internal stock;
            MockReviewedCore internal core;
            MockReviewedWrapper internal wrapper;
            MockReviewedPool internal pool;
            MockReviewedOracle internal oracle;
            EZManagerPoolAdapter internal adapter;
            address internal vaultA = makeAddr("vaultA");
            address internal vaultB = makeAddr("vaultB");

            function setUp() public {
                vm.warp(10 days);
                usdg = new MockERC20("USDG", "USDG", 6, 0);
                stock = new MockERC20("Stock", "STOCK", 18, 0);
                core = new MockReviewedCore(usdg);
                wrapper = new MockReviewedWrapper(core);
                pool = new MockReviewedPool(address(usdg), address(stock));
                oracle = new MockReviewedOracle();
                core.setAllowed(address(pool), true);
                adapter = new EZManagerPoolAdapter(usdg, wrapper, pool, oracle, 1_200, 300, 3 days, 10e6);
            }

            function testKeepsTwoVaultPositionsSeparateAndReturnsUsdg() public {
                _deposit(vaultA, 100e6);
                _deposit(vaultB, 200e6);

                assertEq(adapter.totalAssetsFor(vaultA), 100e6);
                assertEq(adapter.totalAssetsFor(vaultB), 200e6);

                vm.prank(vaultA);
                adapter.withdraw(40e6);
                assertEq(usdg.balanceOf(vaultA), 40e6);
                assertEq(adapter.totalAssetsFor(vaultA), 60e6);
                assertEq(adapter.totalAssetsFor(vaultB), 200e6);

                vm.prank(vaultB);
                adapter.withdraw(200e6);
                assertEq(usdg.balanceOf(vaultB), 200e6);
                assertEq(adapter.totalAssetsFor(vaultB), 0);
            }

            function testStaleOracleAndDeprecatedPoolFailBeforeFundsMove() public {
                usdg.mint(vaultA, 100e6);
                vm.prank(vaultA);
                usdg.approve(address(adapter), 100e6);
                oracle.setRound(100e8, block.timestamp - 3 days - 1);

                vm.expectRevert(EZManagerPoolAdapter.OracleUnavailable.selector);
                vm.prank(vaultA);
                adapter.deposit(100e6);
                assertEq(usdg.balanceOf(vaultA), 100e6);

                oracle.setRound(100e8, block.timestamp);
                core.setDeprecated(address(pool), true);
                vm.expectRevert(EZManagerPoolAdapter.InvalidConfig.selector);
                vm.prank(vaultA);
                adapter.deposit(100e6);
                assertEq(usdg.balanceOf(vaultA), 100e6);
            }

            function _deposit(address vault, uint256 amount) private {
                usdg.mint(vault, amount);
                vm.startPrank(vault);
                usdg.approve(address(adapter), amount);
                adapter.deposit(amount);
                vm.stopPrank();
            }
        }
