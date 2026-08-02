// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStrategyVault} from "./interfaces/IStrategyVault.sol";

/// @notice Enforces the leash around keeper-triggered pool allocations.
contract PolicyExecutor is Ownable, ReentrancyGuard {
    uint256 private constant BPS = 10_000;

    struct Policy {
        address creator;
        uint16 maxSingleBps;
        uint16 maxDailyBps;
        uint16 maxAllocationBps;
        uint32 cooldownSeconds;
        uint40 expiresAt;
        uint40 lastActionAt;
        uint40 dayStartedAt;
        uint256 spentToday;
        bool paused;
        bool exists;
    }

    address public factory;
    mapping(address keeper => bool allowed) public keepers;
    mapping(address vault => Policy policy) public policies;

    event FactorySet(address indexed factory);
    event KeeperSet(address indexed keeper, bool allowed);
    event PolicyRegistered(address indexed vault, address indexed creator, uint16 maxAllocationBps, uint40 expiresAt);
    event VaultPaused(address indexed vault, bool paused);
    event PolicyRenewed(address indexed vault, uint40 expiresAt);
    event AllocationExecuted(address indexed vault, address indexed keeper, uint256 assets);
    event RecallExecuted(address indexed vault, address indexed caller, uint256 assets);

    error OnlyFactory();
    error OnlyKeeper();
    error UnknownVault();
    error PolicyPaused();
    error PolicyExpired();
    error CooldownActive();
    error SingleActionLimit();
    error DailyLimit();
    error AllocationLimit();
    error InvalidPolicy();
    error NotAuthorized();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setFactory(address factory_) external onlyOwner {
        if (factory_ == address(0)) revert InvalidPolicy();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function registerVault(
        address vault,
        address creator,
        uint16 maxSingleBps,
        uint16 maxDailyBps,
        uint16 maxAllocationBps,
        uint32 cooldownSeconds,
        uint40 expiresAt
    ) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (
            vault == address(0) || creator == address(0) || maxSingleBps == 0 || maxSingleBps > BPS || maxDailyBps == 0
                || maxDailyBps > BPS || maxAllocationBps == 0 || maxAllocationBps > BPS || expiresAt <= block.timestamp
        ) revert InvalidPolicy();

        policies[vault] = Policy({
            creator: creator,
            maxSingleBps: maxSingleBps,
            maxDailyBps: maxDailyBps,
            maxAllocationBps: maxAllocationBps,
            cooldownSeconds: cooldownSeconds,
            expiresAt: expiresAt,
            lastActionAt: 0,
            dayStartedAt: uint40(block.timestamp),
            spentToday: 0,
            paused: false,
            exists: true
        });
        emit PolicyRegistered(vault, creator, maxAllocationBps, expiresAt);
    }

    function setPaused(address vault, bool paused) external {
        Policy storage policy = policies[vault];
        if (!policy.exists) revert UnknownVault();
        if (msg.sender != policy.creator && msg.sender != owner()) revert NotAuthorized();
        policy.paused = paused;
        emit VaultPaused(vault, paused);
    }

    function renewPolicy(address vault, uint40 expiresAt) external {
        Policy storage policy = policies[vault];
        if (!policy.exists) revert UnknownVault();
        if (msg.sender != policy.creator && msg.sender != owner()) revert NotAuthorized();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 365 days) revert InvalidPolicy();
        policy.expiresAt = expiresAt;
        emit PolicyRenewed(vault, expiresAt);
    }

    function executeAllocate(address vault, uint256 assets) external nonReentrant {
        _executeAllocate(vault, assets);
    }

    /// @notice Atomically closes and reopens a position at its configured target after policy limits allow it.
    /// @dev Any failed re-allocation reverts the preceding recall, so a recenter never stops halfway.
    function executeRecenter(address vault) external nonReentrant returns (uint256 recalled, uint256 allocated) {
        Policy storage policy = policies[vault];
        _authorizeRecall(policy);
        IStrategyVault strategyVault = IStrategyVault(vault);
        recalled = strategyVault.deployedAssets();
        if (recalled == 0) revert InvalidPolicy();
        strategyVault.recallFromAdapter(recalled);
        emit RecallExecuted(vault, msg.sender, recalled);

        allocated = strategyVault.totalAssets() * policy.maxAllocationBps / BPS;
        _executeAllocate(vault, allocated);
    }

    function _executeAllocate(address vault, uint256 assets) private {
        Policy storage policy = policies[vault];
        if (!policy.exists) revert UnknownVault();
        if (!keepers[msg.sender] && msg.sender != policy.creator) revert OnlyKeeper();
        if (policy.paused) revert PolicyPaused();
        if (block.timestamp >= policy.expiresAt) revert PolicyExpired();
        if (policy.lastActionAt != 0 && block.timestamp < policy.lastActionAt + policy.cooldownSeconds) {
            revert CooldownActive();
        }

        IStrategyVault strategyVault = IStrategyVault(vault);
        uint256 total = strategyVault.totalAssets();
        if (assets == 0 || assets > total * policy.maxSingleBps / BPS) revert SingleActionLimit();

        if (block.timestamp >= policy.dayStartedAt + 1 days) {
            policy.dayStartedAt = uint40(block.timestamp);
            policy.spentToday = 0;
        }
        if (policy.spentToday + assets > total * policy.maxDailyBps / BPS) revert DailyLimit();
        if (strategyVault.deployedAssets() + assets > total * policy.maxAllocationBps / BPS) revert AllocationLimit();

        policy.spentToday += assets;
        policy.lastActionAt = uint40(block.timestamp);
        strategyVault.allocateToAdapter(assets);
        emit AllocationExecuted(vault, msg.sender, assets);
    }

    function executeRecall(address vault, uint256 assets) external nonReentrant {
        Policy storage policy = policies[vault];
        _authorizeRecall(policy);
        IStrategyVault(vault).recallFromAdapter(assets);
        emit RecallExecuted(vault, msg.sender, assets);
    }

    function executeRecallAll(address vault) external nonReentrant returns (uint256 assets) {
        Policy storage policy = policies[vault];
        _authorizeRecall(policy);
        assets = IStrategyVault(vault).deployedAssets();
        if (assets == 0) return 0;
        IStrategyVault(vault).recallFromAdapter(assets);
        emit RecallExecuted(vault, msg.sender, assets);
    }

    function _authorizeRecall(Policy storage policy) private view {
        if (!policy.exists) revert UnknownVault();
        if (!keepers[msg.sender] && msg.sender != policy.creator && msg.sender != owner()) revert NotAuthorized();
    }
}
