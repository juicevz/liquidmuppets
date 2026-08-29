// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Testnet-only adapter. Yield exists only when someone transfers test assets through seedYield.
contract MockYieldPool is IStrategyAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    mapping(address vault => uint256 assets) public positions;

    event Deposited(address indexed vault, uint256 assets);
    event Withdrawn(address indexed vault, uint256 assets);
    event TestYieldSeeded(address indexed vault, address indexed funder, uint256 assets);

    error InsufficientPosition();

    constructor(IERC20 asset_) {
        underlying = asset_;
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function totalAssetsFor(address vault) external view returns (uint256) {
        return positions[vault];
    }

    function deposit(uint256 assets) external {
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        positions[msg.sender] += assets;
        emit Deposited(msg.sender, assets);
    }

    function withdraw(uint256 assets) external {
        if (assets > positions[msg.sender]) revert InsufficientPosition();
        positions[msg.sender] -= assets;
        underlying.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets);
    }

    function seedYield(address vault, uint256 assets) external {
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        positions[vault] += assets;
        emit TestYieldSeeded(vault, msg.sender, assets);
    }
}

