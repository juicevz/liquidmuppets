// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IStrategyVault {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function idleAssets() external view returns (uint256);
    function deployedAssets() external view returns (uint256);
    function taskId() external view returns (uint8);
    function allocateToAdapter(uint256 assets) external;
    function recallFromAdapter(uint256 assets) external;
}

