// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {PolicyExecutor} from "./PolicyExecutor.sol";
import {StrategyVault} from "./StrategyVault.sol";
import {AgentKey} from "./AgentKey.sol";
import {KeyMarketplace} from "./KeyMarketplace.sol";

interface ILegacyLiquidMuppetsFactory {
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

    function agentCount() external view returns (uint256);
    function getAgent(uint256 id) external view returns (AgentRecord memory);
    function getCreatorAgentIds(address creator) external view returns (uint256[] memory);
}

/// @notice Gated factory and reviewed template registry for new LiquidMuppets launches.
/// @dev Legacy agents remain addressable through the same global IDs. Existing vaults are never migrated or replaced.
contract LiquidMuppetsFactoryV2 is Ownable {
    uint8 public constant DEFAULT_POLICY = type(uint8).max;

    struct RiskPreset {
        string label;
        uint16 maxSingleBps;
        uint16 maxDailyBps;
        uint16 maxAllocationBps;
        uint32 cooldownSeconds;
        bool enabled;
    }

    struct TaskConfig {
        IERC20 asset;
        IStrategyAdapter adapter;
        string sharePrefix;
        bytes32 routeId;
        uint16 maxSingleBps;
        uint16 maxDailyBps;
        uint16 maxAllocationBps;
        uint32 cooldownSeconds;
        uint128 depositCap;
        uint8 allowedPresetMask;
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

    IERC20 public immutable accessToken;
    uint256 public immutable minimumAccessBalance;
    PolicyExecutor public immutable policyExecutor;
    KeyMarketplace public immutable keyMarketplace;
    ILegacyLiquidMuppetsFactory public immutable legacyFactory;
    uint256 public immutable legacyAgentCount;
    bool public launchesEnabled;

    mapping(uint8 taskId => TaskConfig config) private taskConfigs;
    mapping(uint8 presetId => RiskPreset preset) private riskPresets;
    mapping(uint8 taskId => bool known) private knownTasks;
    uint8[] private taskIds;
    AgentRecord[] private newAgentRecords;
    mapping(address creator => uint256[] ids) private creatorNewAgentIds;
    mapping(uint256 agentId => uint8 presetId) private agentPresets;

    event RiskPresetConfigured(
        uint8 indexed presetId,
        string label,
        uint16 maxSingleBps,
        uint16 maxDailyBps,
        uint16 maxAllocationBps,
        uint32 cooldownSeconds,
        bool enabled
    );
    event TaskConfigured(
        uint8 indexed taskId,
        address indexed asset,
        address indexed adapter,
        bytes32 routeId,
        uint8 allowedPresetMask,
        bool enabled
    );
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
    event AgentPresetSelected(uint256 indexed agentId, uint8 indexed presetId);
    event LaunchesEnabledSet(bool enabled);

    error InvalidAccessToken();
    error InsufficientAccessBalance(uint256 balance, uint256 required);
    error InvalidPet();
    error InvalidTask();
    error InvalidPreset();
    error InvalidName();
    error InvalidFloor();
    error InvalidPolicy();
    error ContractGovernanceRequired();
    error LaunchesDisabled();
    error OwnershipRenunciationDisabled();

    constructor(
        address initialOwner,
        IERC20 accessToken_,
        uint256 minimumAccessBalance_,
        PolicyExecutor policyExecutor_,
        KeyMarketplace keyMarketplace_,
        ILegacyLiquidMuppetsFactory legacyFactory_
    ) Ownable(initialOwner) {
        if (address(accessToken_).code.length == 0 || minimumAccessBalance_ == 0) {
            revert InvalidAccessToken();
        }
        if (address(policyExecutor_).code.length == 0 || address(keyMarketplace_).code.length == 0) {
            revert InvalidPolicy();
        }
        accessToken = accessToken_;
        minimumAccessBalance = minimumAccessBalance_;
        policyExecutor = policyExecutor_;
        keyMarketplace = keyMarketplace_;
        legacyFactory = legacyFactory_;
        legacyAgentCount = address(legacyFactory_) == address(0) ? 0 : legacyFactory_.agentCount();
    }

    /// @notice Production ownership can only move to deployed governance code, such as a Safe multisig.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner.code.length == 0) revert ContractGovernanceRequired();
        super.transferOwnership(newOwner);
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    function governanceReady() public view returns (bool) {
        return owner().code.length != 0;
    }

    /// @notice Kept off through deployment and source verification, then enabled by the Safe.
    function setLaunchesEnabled(bool enabled) external onlyOwner {
        if (enabled && !governanceReady()) revert ContractGovernanceRequired();
        launchesEnabled = enabled;
        emit LaunchesEnabledSet(enabled);
    }

    function setRiskPreset(uint8 presetId, RiskPreset calldata preset) external onlyOwner {
        if (presetId > 2 || bytes(preset.label).length == 0 || bytes(preset.label).length > 16) {
            revert InvalidPreset();
        }
        _validatePolicy(preset.maxSingleBps, preset.maxDailyBps, preset.maxAllocationBps, preset.cooldownSeconds);
        riskPresets[presetId] = preset;
        emit RiskPresetConfigured(
            presetId,
            preset.label,
            preset.maxSingleBps,
            preset.maxDailyBps,
            preset.maxAllocationBps,
            preset.cooldownSeconds,
            preset.enabled
        );
    }

    function setTaskConfig(uint8 taskId, TaskConfig calldata config) external onlyOwner {
        if (
            address(config.asset).code.length == 0 || address(config.adapter).code.length == 0
                || bytes(config.sharePrefix).length < 2 || bytes(config.sharePrefix).length > 16
                || config.routeId == bytes32(0) || config.depositCap == 0
        ) revert InvalidTask();
        _validatePolicy(config.maxSingleBps, config.maxDailyBps, config.maxAllocationBps, config.cooldownSeconds);
        if (!knownTasks[taskId]) {
            knownTasks[taskId] = true;
            taskIds.push(taskId);
        }
        taskConfigs[taskId] = config;
        emit TaskConfigured(
            taskId,
            address(config.asset),
            address(config.adapter),
            config.routeId,
            config.allowedPresetMask,
            config.enabled
        );
    }

    function createAgent(
        uint8 petId,
        uint8 taskId,
        string calldata name,
        string calldata keySymbol,
        uint256 keySupply,
        uint128 baseFloorWei
    ) external returns (uint256 agentId, address vault, address key) {
        return _createAgent(petId, taskId, DEFAULT_POLICY, name, keySymbol, keySupply, baseFloorWei);
    }

    function createAgentWithPreset(
        uint8 petId,
        uint8 taskId,
        uint8 presetId,
        string calldata name,
        string calldata keySymbol,
        uint256 keySupply,
        uint128 baseFloorWei
    ) external returns (uint256 agentId, address vault, address key) {
        return _createAgent(petId, taskId, presetId, name, keySymbol, keySupply, baseFloorWei);
    }

    function _createAgent(
        uint8 petId,
        uint8 taskId,
        uint8 presetId,
        string calldata name,
        string calldata keySymbol,
        uint256 keySupply,
        uint128 baseFloorWei
    ) private returns (uint256 agentId, address vault, address key) {
        if (!governanceReady()) revert ContractGovernanceRequired();
        if (!launchesEnabled) revert LaunchesDisabled();
        uint256 balance = accessToken.balanceOf(msg.sender);
        if (balance < minimumAccessBalance) revert InsufficientAccessBalance(balance, minimumAccessBalance);
        if (petId > 6) revert InvalidPet();
        TaskConfig storage config = taskConfigs[taskId];
        if (!config.enabled) revert InvalidTask();
        if (
            bytes(name).length == 0 || bytes(name).length > 32 || bytes(keySymbol).length < 2
                || bytes(keySymbol).length > 10
        ) revert InvalidName();
        if (baseFloorWei == 0) revert InvalidFloor();

        (uint16 maxSingleBps, uint16 maxDailyBps, uint16 maxAllocationBps, uint32 cooldownSeconds) =
            _policyFor(config, presetId);
        AgentKey agentKey = new AgentKey(string.concat(name, " Key"), keySymbol, msg.sender, keySupply);
        keyMarketplace.registerKey(agentKey);
        StrategyVault strategyVault = new StrategyVault(
            config.asset,
            string.concat("LiquidMuppets ", name, " Vault"),
            string.concat(config.sharePrefix, "-", keySymbol),
            address(policyExecutor),
            config.adapter,
            taskId,
            config.depositCap
        );
        policyExecutor.registerVault(
            address(strategyVault),
            msg.sender,
            maxSingleBps,
            maxDailyBps,
            maxAllocationBps,
            cooldownSeconds,
            uint40(block.timestamp + 90 days)
        );

        agentId = legacyAgentCount + newAgentRecords.length;
        newAgentRecords.push(
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
        creatorNewAgentIds[msg.sender].push(agentId);
        agentPresets[agentId] = presetId;
        emit AgentCreated(
            agentId, msg.sender, address(strategyVault), address(agentKey), petId, taskId, baseFloorWei, name
        );
        emit AgentPresetSelected(agentId, presetId);
        return (agentId, address(strategyVault), address(agentKey));
    }

    function _policyFor(TaskConfig storage config, uint8 presetId)
        private
        view
        returns (uint16 maxSingleBps, uint16 maxDailyBps, uint16 maxAllocationBps, uint32 cooldownSeconds)
    {
        if (presetId == DEFAULT_POLICY) {
            return (config.maxSingleBps, config.maxDailyBps, config.maxAllocationBps, config.cooldownSeconds);
        }
        if (presetId > 2 || config.allowedPresetMask & uint8(uint256(1) << presetId) == 0) revert InvalidPreset();
        RiskPreset storage preset = riskPresets[presetId];
        if (!preset.enabled) revert InvalidPreset();
        return (preset.maxSingleBps, preset.maxDailyBps, preset.maxAllocationBps, preset.cooldownSeconds);
    }

    function _validatePolicy(uint16 maxSingleBps, uint16 maxDailyBps, uint16 maxAllocationBps, uint32 cooldownSeconds)
        private
        pure
    {
        if (
            maxSingleBps == 0 || maxSingleBps > 10_000 || maxDailyBps == 0 || maxDailyBps > 10_000
                || maxAllocationBps == 0 || maxAllocationBps > 10_000 || maxSingleBps > maxDailyBps
                || maxSingleBps > maxAllocationBps || cooldownSeconds < 5 minutes || cooldownSeconds > 7 days
        ) revert InvalidPolicy();
    }

    function agentCount() external view returns (uint256) {
        return legacyAgentCount + newAgentRecords.length;
    }

    function newAgentCount() external view returns (uint256) {
        return newAgentRecords.length;
    }

    function getAgent(uint256 id) public view returns (AgentRecord memory) {
        if (id < legacyAgentCount) {
            ILegacyLiquidMuppetsFactory.AgentRecord memory legacy = legacyFactory.getAgent(id);
            return AgentRecord({
                creator: legacy.creator,
                vault: legacy.vault,
                key: legacy.key,
                petId: legacy.petId,
                taskId: legacy.taskId,
                createdAt: legacy.createdAt,
                baseFloorWei: legacy.baseFloorWei,
                name: legacy.name
            });
        }
        return newAgentRecords[id - legacyAgentCount];
    }

    function getCreatorAgentIds(address creator) external view returns (uint256[] memory ids) {
        uint256[] memory legacyIds =
            address(legacyFactory) == address(0) ? new uint256[](0) : legacyFactory.getCreatorAgentIds(creator);
        uint256[] storage newIds = creatorNewAgentIds[creator];
        ids = new uint256[](legacyIds.length + newIds.length);
        for (uint256 index = 0; index < legacyIds.length; index++) {
            ids[index] = legacyIds[index];
        }
        for (uint256 index = 0; index < newIds.length; index++) {
            ids[legacyIds.length + index] = newIds[index];
        }
    }

    function getTaskConfig(uint8 taskId) external view returns (TaskConfig memory) {
        return taskConfigs[taskId];
    }

    function getTaskIds() external view returns (uint8[] memory) {
        return taskIds;
    }

    function getRiskPreset(uint8 presetId) external view returns (RiskPreset memory) {
        return riskPresets[presetId];
    }

    function getAgentPreset(uint256 agentId) external view returns (uint8) {
        return agentId < legacyAgentCount ? DEFAULT_POLICY : agentPresets[agentId];
    }
}
