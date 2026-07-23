// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IEZWrapper {
    function CORE() external view returns (IEZCore);
    function USDC() external view returns (IERC20);

    function ezOpen(
        address pool,
        int24 tickLower,
        int24 tickUpper,
        uint256 usdcAmount,
        uint256 slippageBps,
        address referrer
    ) external returns (bytes32 key);

    function ezAdd(bytes32 key, uint256 usdcAmount, uint256 slippageBps) external;
    function ezRemove(bytes32 key, uint256 withdrawUsdc, uint256 slippageBps) external returns (uint256 returnedUsdc);
    function ezExit(bytes32 key, uint256 slippageBps) external returns (uint256 returnedUsdc);
}

interface IEZCore {
    function USDC() external view returns (IERC20);
    function VALUATION() external view returns (IEZValuation);
    function isPoolAllowed(address pool) external view returns (bool);
    function isPoolDeprecated(address pool) external view returns (bool);
    function allowedDexes(address dex) external view returns (bool);
    function positionValueUSDCSingle(bytes32 key) external view returns (uint256 valueUSDC);
}

interface IEZValuation {
    function usdcValue(address dex, address token, uint256 amount) external view returns (uint256);
}

interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
