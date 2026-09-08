// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAgentKeyBinding {
    function boundBalance(address holder) external view returns (uint256);
}

interface IAgentKeyRegistry {
    function approvedKeys(address key) external view returns (bool);
}

/// @notice Locks MUPPETS against permanently bound Agent Keys and distributes real WETH revenue.
/// @dev One reward unit always requires UNIT_SIZE MUPPETS and one unused, permanently bound Key.
contract MuppetAgentBond is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e27;

    IERC20 public immutable MUPPETS;
    IERC20 public immutable WETH;
    uint256 public immutable UNIT_SIZE;
    uint40 public immutable LOCK_DURATION;

    address public rewardNotifier;
    uint256 public totalRewardUnits;
    uint256 public totalBondedMuppets;
    uint256 public rewardPerUnitStored;
    uint256 public rewardRemainderScaled;
    uint256 public rewardLiability;
    uint256 public totalRewardsNotified;
    uint256 public totalRewardsClaimed;

    mapping(address key => uint256 units) public totalRewardUnitsByKey;
    mapping(address key => uint256 rewardPerUnit) public keyRewardPerUnitStored;
    mapping(address key => uint256 remainderScaled) public keyRewardRemainderScaled;
    mapping(address key => uint256 liability) public keyRewardLiability;
    mapping(address key => uint256 amount) public totalKeyRewardsNotified;
    mapping(address key => uint256 amount) public totalKeyRewardsClaimed;

    mapping(address registry => bool allowed) public keyRegistries;
    address[] private registryList;
    mapping(address account => uint256 amount) public bondedBalance;
    mapping(address account => uint256 units) public rewardUnits;
    mapping(address account => mapping(address key => uint256 units)) public unitsByKey;
    mapping(address account => mapping(address key => uint40 timestamp)) public lockedUntil;
    mapping(address account => uint256 checkpoint) public userRewardPerUnitPaid;
    mapping(address account => uint256 amount) public accruedRewards;
    mapping(address account => mapping(address key => uint256 checkpoint)) public userKeyRewardPerUnitPaid;
    mapping(address account => mapping(address key => uint256 amount)) public accruedKeyRewards;

    event KeyRegistrySet(address indexed registry, bool allowed);
    event RewardNotifierSet(address indexed notifier);
    event Bonded(
        address indexed account, address indexed key, uint256 units, uint256 muppetsAmount, uint256 lockedUntil
    );
    event Unbonded(address indexed account, address indexed key, uint256 units, uint256 muppetsAmount);
    event RewardNotified(address indexed source, uint256 amount, uint256 totalUnits);
    event RewardClaimed(address indexed account, uint256 amount);
    event KeyRewardNotified(address indexed source, address indexed key, uint256 amount, uint256 totalUnits);
    event KeyRewardClaimed(address indexed account, address indexed key, uint256 amount);

    error AddressZero();
    error ContractGovernanceRequired();
    error ExactTransferRequired();
    error InvalidAgentKey();
    error InvalidAmount();
    error LockActive(uint256 lockedUntilTimestamp);
    error MissingBoundKeys(uint256 available, uint256 required);
    error NoRewardUnits();
    error NotRewardNotifier();
    error OwnershipRenunciationDisabled();
    error UnsafeActivation();

    constructor(address initialOwner, IERC20 muppets, IERC20 weth, uint256 unitSize, uint40 lockDuration)
        Ownable(initialOwner)
    {
        if (address(muppets) == address(0) || address(weth) == address(0)) revert AddressZero();
        if (address(muppets).code.length == 0 || address(weth).code.length == 0) revert AddressZero();
        if (unitSize == 0 || lockDuration == 0) revert InvalidAmount();
        if (IERC20Metadata(address(muppets)).decimals() != 18 || IERC20Metadata(address(weth)).decimals() != 18) {
            revert InvalidAmount();
        }
        MUPPETS = muppets;
        WETH = weth;
        UNIT_SIZE = unitSize;
        LOCK_DURATION = lockDuration;
        _pause();
    }

    modifier onlyRewardNotifier() {
        if (msg.sender != rewardNotifier) revert NotRewardNotifier();
        _;
    }

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

    function setKeyRegistry(address registry, bool allowed) external onlyOwner whenPaused {
        if (registry == address(0) || (allowed && registry.code.length == 0)) revert AddressZero();
        if (allowed && !keyRegistries[registry]) registryList.push(registry);
        keyRegistries[registry] = allowed;
        emit KeyRegistrySet(registry, allowed);
    }

    function setRewardNotifier(address notifier) external onlyOwner whenPaused {
        if (notifier == address(0) || notifier.code.length == 0) revert AddressZero();
        rewardNotifier = notifier;
        emit RewardNotifierSet(notifier);
    }

    function activate() external onlyOwner {
        if (!governanceReady() || rewardNotifier == address(0) || !_hasActiveRegistry()) revert UnsafeActivation();
        _unpause();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function bond(address key, uint256 units) external nonReentrant whenNotPaused {
        if (units == 0) revert InvalidAmount();
        if (!_approvedAgentKey(key)) revert InvalidAgentKey();

        uint256 committed = unitsByKey[msg.sender][key];
        uint256 bound = IAgentKeyBinding(key).boundBalance(msg.sender);
        uint256 available = bound > committed ? bound - committed : 0;
        if (available < units) revert MissingBoundKeys(available, units);

        _accrue(msg.sender);
        _accrueKey(msg.sender, key);
        uint256 amount = units * UNIT_SIZE;
        uint256 balanceBefore = MUPPETS.balanceOf(address(this));
        MUPPETS.safeTransferFrom(msg.sender, address(this), amount);
        if (MUPPETS.balanceOf(address(this)) - balanceBefore != amount) revert ExactTransferRequired();

        unitsByKey[msg.sender][key] = committed + units;
        rewardUnits[msg.sender] += units;
        bondedBalance[msg.sender] += amount;
        totalRewardUnits += units;
        totalRewardUnitsByKey[key] += units;
        totalBondedMuppets += amount;
        uint40 nextUnlock = uint40(block.timestamp) + LOCK_DURATION;
        if (nextUnlock > lockedUntil[msg.sender][key]) lockedUntil[msg.sender][key] = nextUnlock;
        userRewardPerUnitPaid[msg.sender] = rewardPerUnitStored;

        emit Bonded(msg.sender, key, units, amount, nextUnlock);
    }

    /// @notice Returns MUPPETS after the lock. The Agent Key remains permanently bound in its own contract.
    function unbond(address key, uint256 units) external nonReentrant {
        uint256 committed = unitsByKey[msg.sender][key];
        if (units == 0 || units > committed) revert InvalidAmount();
        uint40 unlockTimestamp = lockedUntil[msg.sender][key];
        if (block.timestamp < unlockTimestamp) revert LockActive(unlockTimestamp);

        _accrue(msg.sender);
        _accrueKey(msg.sender, key);
        uint256 amount = units * UNIT_SIZE;
        unitsByKey[msg.sender][key] = committed - units;
        rewardUnits[msg.sender] -= units;
        bondedBalance[msg.sender] -= amount;
        totalRewardUnits -= units;
        totalRewardUnitsByKey[key] -= units;
        totalBondedMuppets -= amount;
        userRewardPerUnitPaid[msg.sender] = rewardPerUnitStored;
        MUPPETS.safeTransfer(msg.sender, amount);

        emit Unbonded(msg.sender, key, units, amount);
    }

    function notifyReward(uint256 amount) external nonReentrant whenNotPaused onlyRewardNotifier {
        if (amount == 0) revert InvalidAmount();
        uint256 units = totalRewardUnits;
        if (units == 0) revert NoRewardUnits();

        uint256 balanceBefore = WETH.balanceOf(address(this));
        WETH.safeTransferFrom(msg.sender, address(this), amount);
        if (WETH.balanceOf(address(this)) - balanceBefore != amount) revert ExactTransferRequired();

        uint256 scaled = amount * PRECISION + rewardRemainderScaled;
        rewardPerUnitStored += scaled / units;
        rewardRemainderScaled = scaled % units;
        rewardLiability += amount;
        totalRewardsNotified += amount;
        emit RewardNotified(msg.sender, amount, units);
    }

    /// @notice Adds WETH revenue only for units bonded with the exact Agent Key.
    function notifyKeyReward(address key, uint256 amount) external nonReentrant whenNotPaused onlyRewardNotifier {
        if (amount == 0) revert InvalidAmount();
        uint256 units = totalRewardUnitsByKey[key];
        if (units == 0) revert NoRewardUnits();

        uint256 balanceBefore = WETH.balanceOf(address(this));
        WETH.safeTransferFrom(msg.sender, address(this), amount);
        if (WETH.balanceOf(address(this)) - balanceBefore != amount) revert ExactTransferRequired();

        uint256 scaled = amount * PRECISION + keyRewardRemainderScaled[key];
        keyRewardPerUnitStored[key] += scaled / units;
        keyRewardRemainderScaled[key] = scaled % units;
        keyRewardLiability[key] += amount;
        rewardLiability += amount;
        totalKeyRewardsNotified[key] += amount;
        totalRewardsNotified += amount;
        emit KeyRewardNotified(msg.sender, key, amount, units);
    }

    function claimReward() external nonReentrant returns (uint256 amount) {
        _accrue(msg.sender);
        amount = accruedRewards[msg.sender];
        if (amount == 0) revert InvalidAmount();
        accruedRewards[msg.sender] = 0;
        rewardLiability -= amount;
        totalRewardsClaimed += amount;
        WETH.safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    function claimKeyReward(address key) external nonReentrant returns (uint256 amount) {
        _accrueKey(msg.sender, key);
        amount = accruedKeyRewards[msg.sender][key];
        if (amount == 0) revert InvalidAmount();
        accruedKeyRewards[msg.sender][key] = 0;
        keyRewardLiability[key] -= amount;
        rewardLiability -= amount;
        totalKeyRewardsClaimed[key] += amount;
        totalRewardsClaimed += amount;
        WETH.safeTransfer(msg.sender, amount);
        emit KeyRewardClaimed(msg.sender, key, amount);
    }

    function pendingReward(address account) external view returns (uint256) {
        uint256 pending = accruedRewards[account];
        uint256 delta = rewardPerUnitStored - userRewardPerUnitPaid[account];
        return pending + rewardUnits[account] * delta / PRECISION;
    }

    function pendingKeyReward(address account, address key) external view returns (uint256) {
        uint256 pending = accruedKeyRewards[account][key];
        uint256 delta = keyRewardPerUnitStored[key] - userKeyRewardPerUnitPaid[account][key];
        return pending + unitsByKey[account][key] * delta / PRECISION;
    }

    function availableBoundKeys(address account, address key) external view returns (uint256) {
        uint256 bound = IAgentKeyBinding(key).boundBalance(account);
        uint256 committed = unitsByKey[account][key];
        return bound > committed ? bound - committed : 0;
    }

    function registryCount() external view returns (uint256) {
        return registryList.length;
    }

    function registryAt(uint256 index) external view returns (address) {
        return registryList[index];
    }

    function _accrue(address account) private {
        uint256 checkpoint = rewardPerUnitStored;
        uint256 delta = checkpoint - userRewardPerUnitPaid[account];
        if (delta != 0 && rewardUnits[account] != 0) {
            accruedRewards[account] += rewardUnits[account] * delta / PRECISION;
        }
        userRewardPerUnitPaid[account] = checkpoint;
    }

    function _accrueKey(address account, address key) private {
        uint256 checkpoint = keyRewardPerUnitStored[key];
        uint256 delta = checkpoint - userKeyRewardPerUnitPaid[account][key];
        if (delta != 0 && unitsByKey[account][key] != 0) {
            accruedKeyRewards[account][key] += unitsByKey[account][key] * delta / PRECISION;
        }
        userKeyRewardPerUnitPaid[account][key] = checkpoint;
    }

    function _approvedAgentKey(address key) private view returns (bool) {
        if (key == address(0) || key.code.length == 0) return false;
        try IERC20Metadata(key).decimals() returns (uint8 decimals) {
            if (decimals != 0) return false;
        } catch {
            return false;
        }
        for (uint256 index; index < registryList.length; ++index) {
            address registry = registryList[index];
            if (!keyRegistries[registry]) continue;
            try IAgentKeyRegistry(registry).approvedKeys(key) returns (bool approved) {
                if (approved) return true;
            } catch {}
        }
        return false;
    }

    function _hasActiveRegistry() private view returns (bool) {
        for (uint256 index; index < registryList.length; ++index) {
            if (keyRegistries[registryList[index]]) return true;
        }
        return false;
    }
}
