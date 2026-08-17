// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IStrategyAdapter {
    function asset() external view returns (address);
    function totalAssetsFor(address vault) external view returns (uint256);
    function deposit(uint256 assets) external;
    function withdraw(uint256 assets) external;
}

