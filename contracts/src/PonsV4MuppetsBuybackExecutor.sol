// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Executes a bounded native-token to MUPPETS swap in the graduated Pons Uniswap v4 pool.
/// @dev The caller supplies its own native token and receives only the measured MUPPETS output.
contract PonsV4MuppetsBuybackExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    uint8 private constant V4_SWAP = 0x10;
    uint8 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 private constant SETTLE_ALL = 0x0c;
    uint8 private constant TAKE_ALL = 0x0f;
    uint256 public constant MAX_DEADLINE_WINDOW = 5 minutes;

    IERC20 public immutable MUPPETS;
    IUniversalRouter public immutable UNIVERSAL_ROUTER;
    address public immutable PONS_HOOK;
    int24 public immutable TICK_SPACING;
    bytes32 public immutable POOL_ID;

    event BuyExecuted(
        address indexed caller,
        address indexed recipient,
        uint256 nativeSpent,
        uint256 muppetsReceived,
        uint256 minimumOutput
    );

    error AddressZero();
    error ContractRequired();
    error DeadlineInvalid();
    error InvalidAmount();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error UnexpectedRefund(uint256 amount);

    constructor(IERC20 muppets, IUniversalRouter universalRouter, address ponsHook, int24 tickSpacing) {
        if (address(muppets) == address(0) || address(universalRouter) == address(0) || ponsHook == address(0)) {
            revert AddressZero();
        }
        if (address(muppets).code.length == 0 || address(universalRouter).code.length == 0 || ponsHook.code.length == 0)
        {
            revert ContractRequired();
        }
        if (tickSpacing <= 0) revert InvalidAmount();
        MUPPETS = muppets;
        UNIVERSAL_ROUTER = universalRouter;
        PONS_HOOK = ponsHook;
        TICK_SPACING = tickSpacing;
        POOL_ID = keccak256(abi.encode(address(0), address(muppets), uint24(0), tickSpacing, ponsHook));
    }

    receive() external payable {}

    function executeBuy(uint256 minimumOutput, uint256 deadline, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (recipient == address(0)) revert AddressZero();
        if (msg.value == 0 || msg.value > type(uint128).max || minimumOutput == 0 || minimumOutput > type(uint128).max)
        {
            revert InvalidAmount();
        }
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineInvalid();

        uint256 nativeBalanceBefore = address(this).balance - msg.value;
        uint256 tokenBalanceBefore = MUPPETS.balanceOf(address(this));
        PoolKey memory poolKey = PoolKey(address(0), address(MUPPETS), 0, TICK_SPACING, PONS_HOOK);
        ExactInputSingleParams memory swapParams = ExactInputSingleParams({
            poolKey: poolKey,
            zeroForOne: true,
            amountIn: uint128(msg.value),
            amountOutMinimum: uint128(minimumOutput),
            minHopPriceX36: 0,
            hookData: bytes("")
        });

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(swapParams);
        params[1] = abi.encode(address(0), msg.value);
        params[2] = abi.encode(address(MUPPETS), minimumOutput);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        UNIVERSAL_ROUTER.execute{value: msg.value}(abi.encodePacked(V4_SWAP), inputs, deadline);

        amountOut = MUPPETS.balanceOf(address(this)) - tokenBalanceBefore;
        if (amountOut < minimumOutput) revert SlippageExceeded(amountOut, minimumOutput);
        MUPPETS.safeTransfer(recipient, amountOut);

        uint256 nativeRefund = address(this).balance - nativeBalanceBefore;
        if (nativeRefund != 0) revert UnexpectedRefund(nativeRefund);
        emit BuyExecuted(msg.sender, recipient, msg.value, amountOut, minimumOutput);
    }
}
