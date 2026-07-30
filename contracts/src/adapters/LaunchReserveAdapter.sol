// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Isolates a bounded WETH reserve while the launch-pool route has no approved venue.
/// @dev This adapter cannot trade, bridge, lend, or transfer funds to an administrator.
contract LaunchReserveAdapter is IStrategyAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable weth;
    mapping(address vault => uint256 assets) public reserveOf;

    event ReserveStaged(address indexed vault, uint256 assets);
    event ReserveReleased(address indexed vault, uint256 assets);

    error InvalidAsset();
    error InvalidAmount();
    error InsufficientReserve();

    constructor(IERC20 weth_) {
        if (address(weth_).code.length == 0) revert InvalidAsset();
        weth = weth_;
    }

    function asset() external view returns (address) {
        return address(weth);
    }

    function totalAssetsFor(address vault) external view returns (uint256) {
        return reserveOf[vault];
    }

    function deposit(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 beforeBalance = weth.balanceOf(address(this));
        weth.safeTransferFrom(msg.sender, address(this), assets);
        if (weth.balanceOf(address(this)) - beforeBalance != assets) revert InvalidAmount();
        reserveOf[msg.sender] += assets;
        emit ReserveStaged(msg.sender, assets);
    }

    function withdraw(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 reserve = reserveOf[msg.sender];
        if (assets > reserve) revert InsufficientReserve();
        reserveOf[msg.sender] = reserve - assets;
        weth.safeTransfer(msg.sender, assets);
        emit ReserveReleased(msg.sender, assets);
    }
}
