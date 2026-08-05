// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {PolicyExecutor} from "./PolicyExecutor.sol";
import {StrategyVault} from "./StrategyVault.sol";
import {AgentKey} from "./AgentKey.sol";
import {KeyMarketplace} from "./KeyMarketplace.sol";

/// @notice Deploys a separate vault share and Agent Key for a selected pet and strategy task.
contract LiquidMuppetsFactory is Ownable {
    struct TaskConfig {
        IERC20 asset;
        IStrategyAdapter adapter;
        string sharePrefix;
        uint16 maxSingleBps;
        uint16 maxDailyBps;
        uint16 maxAllocationBps;
        uint32 cooldownSeconds;
        uint128 depositCap;
        bool enabled;
    }

    struct AgentRecord {
        address creator;
        address vault;
        address key;
        uint8 petId;
        uint8 taskId;
        uint40 createdAt;
        uint128 baseFloorWei;
        string name;
    }

    PolicyExecutor public immutable policyExecutor;
    KeyMarketplace public immutable keyMarketplace;
    mapping(uint8 taskId => TaskConfig config) private taskConfigs;
    AgentRecord[] private agentRecords;
    mapping(address creator => uint256[] ids) private creatorAgentIds;

    event TaskConfigured(uint8 indexed taskId, address indexed asset, address indexed adapter, bool enabled);
    event AgentCreated(
        uint256 indexed agentId,
        address indexed creator,
        address indexed vault,
        address key,
        uint8 petId,
        uint8 taskId,
        uint256 baseFloorWei,
        string name
    );

    error InvalidPet();
    error InvalidTask();
    error InvalidName();
    error InvalidFloor();

    constructor(address initialOwner, PolicyExecutor policyExecutor_, KeyMarketplace keyMarketplace_)
        Ownable(initialOwner)
    {
        policyExecutor = policyExecutor_;
        keyMarketplace = keyMarketplace_;
    }

    function setTaskConfig(uint8 taskId, TaskConfig calldata config) external onlyOwner {
        if (taskId > 2 || address(config.asset) == address(0) || address(config.adapter) == address(0)) {
            revert InvalidTask();
        }
        taskConfigs[taskId] = config;
        emit TaskConfigured(taskId, address(config.asset), address(config.adapter), config.enabled);
    }

    function createAgent(
        uint8 petId,
        uint8 taskId,
        string calldata name,
        string calldata keySymbol,
        uint256 keySupply,
        uint128 baseFloorWei
    ) external returns (uint256 agentId, address vault, address key) {
        if (petId > 6) revert InvalidPet();
        TaskConfig storage config = taskConfigs[taskId];
        if (!config.enabled) revert InvalidTask();
        if (
            bytes(name).length == 0 || bytes(name).length > 32 || bytes(keySymbol).length < 2
                || bytes(keySymbol).length > 10
        ) {
            revert InvalidName();
        }
        if (baseFloorWei == 0) revert InvalidFloor();

        AgentKey agentKey = new AgentKey(string.concat(name, " Key"), keySymbol, msg.sender, keySupply);
        keyMarketplace.registerKey(agentKey);
        string memory shareSymbol = string.concat(config.sharePrefix, "-", keySymbol);
        StrategyVault strategyVault = new StrategyVault(
            config.asset,
            string.concat("LiquidMuppets ", name, " Vault"),
            shareSymbol,
            address(policyExecutor),
            config.adapter,
            taskId,
            config.depositCap
        );

        policyExecutor.registerVault(
            address(strategyVault),
            msg.sender,
            config.maxSingleBps,
            config.maxDailyBps,
            config.maxAllocationBps,
            config.cooldownSeconds,
            uint40(block.timestamp + 90 days)
        );

        agentId = agentRecords.length;
        agentRecords.push(
            AgentRecord({
                creator: msg.sender,
                vault: address(strategyVault),
                key: address(agentKey),
                petId: petId,
                taskId: taskId,
                createdAt: uint40(block.timestamp),
                baseFloorWei: baseFloorWei,
                name: name
            })
        );
        creatorAgentIds[msg.sender].push(agentId);
        emit AgentCreated(
            agentId, msg.sender, address(strategyVault), address(agentKey), petId, taskId, baseFloorWei, name
        );
        return (agentId, address(strategyVault), address(agentKey));
    }

    function agentCount() external view returns (uint256) {
        return agentRecords.length;
    }

    function getAgent(uint256 id) external view returns (AgentRecord memory) {
        return agentRecords[id];
    }

    function getCreatorAgentIds(address creator) external view returns (uint256[] memory) {
        return creatorAgentIds[creator];
    }

    function getTaskConfig(uint8 taskId) external view returns (TaskConfig memory) {
        return taskConfigs[taskId];
    }
}
