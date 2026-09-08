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

interface IMuppetRewardBuyExecutor {
    function MUPPETS() external view returns (IERC20);
    function executeBuy(uint256 minimumOutput, uint256 deadline, address recipient)
        external
        payable
        returns (uint256 amountOut);
}

interface IWrappedBondReward {
    function withdraw(uint256 amount) external;
}

/// @notice Locks MUPPETS against permanently bound Agent Keys and distributes recorded WETH by completed epoch.
/// @dev A position earns only in full epochs after maturation and before its immutable unlock time.
contract MuppetAgentBond is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e27;
    uint16 public constant BPS = 10_000;
    uint40 public constant EPOCH_DURATION = 7 days;
    uint40 public constant MATURATION_DURATION = 7 days;
    uint256 public constant REINVESTMENT_VERSION = 1;
    uint256 public constant EARN_ACCOUNTING_VERSION = 1;
    uint256 public constant MAX_REINVESTMENT_DEADLINE_WINDOW = 5 minutes;

    enum BondTerm {
        THIRTY_DAYS,
        NINETY_DAYS,
        ONE_EIGHTY_DAYS
    }

    struct BondPosition {
        address account;
        address key;
        uint128 units;
        uint128 rewardWeight;
        uint40 bondedAt;
        uint40 maturesAt;
        uint40 unlockAt;
        uint40 firstEligibleEpoch;
        uint40 lastEligibleEpochExclusive;
        uint16 multiplierBps;
        BondTerm term;
        bool withdrawn;
    }

    IERC20 public immutable MUPPETS;
    IERC20 public immutable WETH;
    IMuppetRewardBuyExecutor public immutable REWARD_BUY_EXECUTOR;
    uint256 public immutable UNIT_SIZE;
    uint40 public immutable LOCK_DURATION;

    address public rewardNotifier;
    uint256 public nextPositionId = 1;
    uint256 public totalRewardUnits;
    uint256 public totalBondedMuppets;
    uint256 public rewardLiability;
    uint256 public totalRewardsNotified;
    uint256 public totalRewardsClaimed;
    uint256 public totalGlobalRewardsNotified;
    uint256 public totalGlobalRewardsClaimed;
    mapping(address account => uint256 amount) public accountRewardsClaimed;
    mapping(address account => uint256 amount) public accountRewardsReinvested;

    mapping(address key => uint256 units) public totalRewardUnitsByKey;
    mapping(address key => uint256 liability) public keyRewardLiability;
    mapping(address key => uint256 amount) public totalKeyRewardsNotified;
    mapping(address key => uint256 amount) public totalKeyRewardsClaimed;

    mapping(uint40 epoch => uint256 weight) public totalRewardWeightAtEpoch;
    mapping(address key => mapping(uint40 epoch => uint256 weight)) public totalKeyRewardWeightAtEpoch;
    mapping(uint40 epoch => uint256 accumulator) public rewardPerWeightAtEpoch;
    mapping(uint40 epoch => uint256 remainderScaled) public rewardRemainderScaledAtEpoch;
    mapping(address key => mapping(uint40 epoch => uint256 accumulator)) public keyRewardPerWeightAtEpoch;
    mapping(address key => mapping(uint40 epoch => uint256 remainderScaled)) public keyRewardRemainderScaledAtEpoch;

    mapping(address registry => bool allowed) public keyRegistries;
    address[] private registryList;
    mapping(address account => uint256 amount) public bondedBalance;
    mapping(address account => uint256 units) public rewardUnits;
    mapping(address account => mapping(address key => uint256 units)) public unitsByKey;
    mapping(address account => mapping(address key => uint40 timestamp)) public lockedUntil;
    mapping(uint256 positionId => BondPosition position) public positions;
    mapping(address account => uint256[] positionIds) private accountPositions;
    mapping(address account => mapping(address key => uint256[] positionIds)) private accountKeyPositions;
    mapping(uint256 positionId => mapping(uint40 epoch => uint256 amount)) public globalRewardClaimedByEpoch;
    mapping(uint256 positionId => mapping(uint40 epoch => uint256 amount)) public keyRewardClaimedByEpoch;

    event KeyRegistrySet(address indexed registry, bool allowed);
    event RewardNotifierSet(address indexed notifier);
    event Bonded(
        uint256 indexed positionId,
        address indexed account,
        address indexed key,
        uint256 units,
        uint256 muppetsAmount,
        BondTerm term,
        uint256 multiplierBps,
        uint256 maturesAt,
        uint256 unlockAt,
        uint256 firstEligibleEpoch,
        uint256 lastEligibleEpochExclusive
    );
    event Unbonded(
        uint256 indexed positionId, address indexed account, address indexed key, uint256 units, uint256 muppetsAmount
    );
    event RewardNotified(address indexed source, uint40 indexed epoch, uint256 amount, uint256 totalWeight);
    event KeyRewardNotified(
        address indexed source, address indexed key, uint40 indexed epoch, uint256 amount, uint256 totalWeight
    );
    event PositionRewardsClaimed(
        uint256 indexed positionId, address indexed account, address indexed key, uint256 globalWeth, uint256 keyWeth
    );
    event PositionRewardsReinvested(
        uint256 indexed positionId,
        uint256 indexed newPositionId,
        address indexed account,
        uint256 wethSpent,
        uint256 muppetsBought,
        uint256 muppetsBonded,
        uint256 wethReturned,
        uint256 muppetsReturned
    );

    error AddressZero();
    error ContractGovernanceRequired();
    error EpochNotComplete(uint256 epoch);
    error ExactTransferRequired();
    error InvalidAgentKey();
    error InvalidAmount();
    error InvalidPosition();
    error LockActive(uint256 lockedUntilTimestamp);
    error MissingBoundKeys(uint256 available, uint256 required);
    error NoEligibleEpochs();
    error NoRewardUnits();
    error NotPositionOwner();
    error NotRewardNotifier();
    error OwnershipRenunciationDisabled();
    error UnsafeActivation();
    error DeadlineInvalid();
    error InvalidBuyExecutor();
    error InsufficientBoughtMuppets(uint256 bought, uint256 required);
    error RewardSpendExceeded(uint256 available, uint256 requested);
    error UnexpectedNativeTransfer();

    constructor(
        address initialOwner,
        IERC20 muppets,
        IERC20 weth,
        uint256 unitSize,
        uint40 lockDuration,
        IMuppetRewardBuyExecutor rewardBuyExecutor
    ) Ownable(initialOwner) {
        if (address(muppets) == address(0) || address(weth) == address(0)) revert AddressZero();
        if (address(muppets).code.length == 0 || address(weth).code.length == 0) revert AddressZero();
        if (unitSize == 0 || lockDuration != 30 days) revert InvalidAmount();
        if (IERC20Metadata(address(muppets)).decimals() != 18 || IERC20Metadata(address(weth)).decimals() != 18) {
            revert InvalidAmount();
        }
        if (address(rewardBuyExecutor).code.length == 0 || address(rewardBuyExecutor.MUPPETS()) != address(muppets)) {
            revert InvalidBuyExecutor();
        }
        MUPPETS = muppets;
        WETH = weth;
        REWARD_BUY_EXECUTOR = rewardBuyExecutor;
        UNIT_SIZE = unitSize;
        LOCK_DURATION = lockDuration;
        _pause();
    }

    receive() external payable {
        if (msg.sender != address(WETH)) revert UnexpectedNativeTransfer();
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

    /// @notice Creates a default 30-day position. It matures for seven days before any epoch eligibility.
    function bond(address key, uint256 units) external nonReentrant whenNotPaused returns (uint256 positionId) {
        return _bond(msg.sender, key, units, BondTerm.THIRTY_DAYS, false);
    }

    function bondWithTerm(address key, uint256 units, BondTerm term)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 positionId)
    {
        return _bond(msg.sender, key, units, term, false);
    }

    /// @notice Returns all MUPPETS in one matured position. Historical epoch rewards remain claimable.
    function unbondPosition(uint256 positionId) external nonReentrant {
        BondPosition storage position = positions[positionId];
        if (position.account == address(0)) revert InvalidPosition();
        if (position.account != msg.sender) revert NotPositionOwner();
        if (position.withdrawn) revert InvalidPosition();
        if (block.timestamp < position.unlockAt) revert LockActive(position.unlockAt);

        position.withdrawn = true;
        uint256 units = position.units;
        uint256 amount = units * UNIT_SIZE;
        unitsByKey[msg.sender][position.key] -= units;
        rewardUnits[msg.sender] -= units;
        bondedBalance[msg.sender] -= amount;
        totalRewardUnits -= units;
        totalRewardUnitsByKey[position.key] -= units;
        totalBondedMuppets -= amount;
        MUPPETS.safeTransfer(msg.sender, amount);

        emit Unbonded(positionId, msg.sender, position.key, units, amount);
    }

    function notifyReward(uint40 epoch, uint256 amount) external nonReentrant whenNotPaused onlyRewardNotifier {
        if (amount == 0) revert InvalidAmount();
        _requireCompletedEpoch(epoch);
        uint256 weight = totalRewardWeightAtEpoch[epoch];
        if (weight == 0) revert NoRewardUnits();

        _receiveWeth(amount);
        uint256 scaled = amount * PRECISION + rewardRemainderScaledAtEpoch[epoch];
        rewardPerWeightAtEpoch[epoch] += scaled / weight;
        rewardRemainderScaledAtEpoch[epoch] = scaled % weight;
        rewardLiability += amount;
        totalGlobalRewardsNotified += amount;
        totalRewardsNotified += amount;
        emit RewardNotified(msg.sender, epoch, amount, weight);
    }

    function notifyKeyReward(address key, uint40 epoch, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        onlyRewardNotifier
    {
        if (key == address(0) || amount == 0) revert InvalidAmount();
        _requireCompletedEpoch(epoch);
        uint256 weight = totalKeyRewardWeightAtEpoch[key][epoch];
        if (weight == 0) revert NoRewardUnits();

        _receiveWeth(amount);
        uint256 scaled = amount * PRECISION + keyRewardRemainderScaledAtEpoch[key][epoch];
        keyRewardPerWeightAtEpoch[key][epoch] += scaled / weight;
        keyRewardRemainderScaledAtEpoch[key][epoch] = scaled % weight;
        keyRewardLiability[key] += amount;
        rewardLiability += amount;
        totalKeyRewardsNotified[key] += amount;
        totalRewardsNotified += amount;
        emit KeyRewardNotified(msg.sender, key, epoch, amount, weight);
    }

    /// @notice Claims global and exact-Key WETH for every eligible epoch in one position.
    function claimPositionRewards(uint256 positionId)
        external
        nonReentrant
        returns (uint256 globalWeth, uint256 keyWeth)
    {
        (globalWeth, keyWeth) = _claimPositionRewards(positionId);
        WETH.safeTransfer(msg.sender, globalWeth + keyWeth);
    }

    /// @notice Claims a position and spends only the selected portion of those rewards on a fresh bond.
    /// @dev No wallet allowance is needed. Failure rolls back the claim, swap and new lock together.
    function claimBuyAndBond(
        uint256 positionId,
        uint256 wethToSpend,
        address key,
        uint256 units,
        BondTerm term,
        uint256 minimumOutput,
        uint256 deadline
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 newPositionId, uint256 muppetsBought, uint256 globalClaimed, uint256 keyClaimed)
    {
        if (wethToSpend == 0 || units == 0 || units > type(uint128).max) {
            revert InvalidAmount();
        }
        uint256 muppetsToBond = units * UNIT_SIZE;
        if (minimumOutput < muppetsToBond) revert InsufficientBoughtMuppets(minimumOutput, muppetsToBond);
        if (deadline < block.timestamp || deadline > block.timestamp + MAX_REINVESTMENT_DEADLINE_WINDOW) {
            revert DeadlineInvalid();
        }
        (globalClaimed, keyClaimed) = _claimPositionRewards(positionId);
        uint256 claimed = globalClaimed + keyClaimed;
        if (wethToSpend > claimed) revert RewardSpendExceeded(claimed, wethToSpend);

        uint256 nativeBalanceBefore = address(this).balance;
        uint256 muppetsBalanceBefore = MUPPETS.balanceOf(address(this));
        IWrappedBondReward(address(WETH)).withdraw(wethToSpend);
        REWARD_BUY_EXECUTOR.executeBuy{value: wethToSpend}(minimumOutput, deadline, address(this));
        if (address(this).balance != nativeBalanceBefore) revert UnexpectedNativeTransfer();
        muppetsBought = MUPPETS.balanceOf(address(this)) - muppetsBalanceBefore;
        if (muppetsBought < minimumOutput) revert InsufficientBoughtMuppets(muppetsBought, minimumOutput);

        // This path never pulls wallet tokens: the measured purchase funds the entire fresh position.
        newPositionId = _bond(msg.sender, key, units, term, true);
        uint256 muppetsReturned = muppetsBought - muppetsToBond;
        uint256 wethReturned = claimed - wethToSpend;
        if (muppetsReturned != 0) MUPPETS.safeTransfer(msg.sender, muppetsReturned);
        if (wethReturned != 0) WETH.safeTransfer(msg.sender, wethReturned);
        accountRewardsReinvested[msg.sender] += wethToSpend;
        emit PositionRewardsReinvested(
            positionId,
            newPositionId,
            msg.sender,
            wethToSpend,
            muppetsBought,
            muppetsToBond,
            wethReturned,
            muppetsReturned
        );
    }

    function _claimPositionRewards(uint256 positionId) private returns (uint256 globalWeth, uint256 keyWeth) {
        BondPosition storage position = positions[positionId];
        if (position.account == address(0)) revert InvalidPosition();
        if (position.account != msg.sender) revert NotPositionOwner();

        (globalWeth, keyWeth) = _checkpointPositionRewards(positionId, position);
        uint256 amount = globalWeth + keyWeth;
        if (amount == 0) revert InvalidAmount();
        rewardLiability -= amount;
        keyRewardLiability[position.key] -= keyWeth;
        totalGlobalRewardsClaimed += globalWeth;
        totalKeyRewardsClaimed[position.key] += keyWeth;
        totalRewardsClaimed += amount;
        accountRewardsClaimed[msg.sender] += amount;
        emit PositionRewardsClaimed(positionId, msg.sender, position.key, globalWeth, keyWeth);
    }

    function pendingPositionRewards(uint256 positionId) public view returns (uint256 globalWeth, uint256 keyWeth) {
        BondPosition storage position = positions[positionId];
        if (position.account == address(0)) return (0, 0);
        uint256 weight = position.rewardWeight;
        for (uint40 epoch = position.firstEligibleEpoch; epoch < position.lastEligibleEpochExclusive; ++epoch) {
            uint256 globalEntitlement = weight * rewardPerWeightAtEpoch[epoch] / PRECISION;
            uint256 keyEntitlement = weight * keyRewardPerWeightAtEpoch[position.key][epoch] / PRECISION;
            globalWeth += globalEntitlement - globalRewardClaimedByEpoch[positionId][epoch];
            keyWeth += keyEntitlement - keyRewardClaimedByEpoch[positionId][epoch];
        }
    }

    /// @notice Aggregate read helper. Claims remain position-scoped so transaction gas stays bounded.
    function pendingReward(address account) external view returns (uint256 amount) {
        uint256[] storage positionIds = accountPositions[account];
        for (uint256 index; index < positionIds.length; ++index) {
            (uint256 globalWeth,) = pendingPositionRewards(positionIds[index]);
            amount += globalWeth;
        }
    }

    /// @notice Aggregate global plus exact-Key helper for public wallet summaries.
    function pendingTotalReward(address account) external view returns (uint256 amount) {
        uint256[] storage positionIds = accountPositions[account];
        for (uint256 index; index < positionIds.length; ++index) {
            (uint256 globalWeth, uint256 keyWeth) = pendingPositionRewards(positionIds[index]);
            amount += globalWeth + keyWeth;
        }
    }

    /// @notice Aggregate exact-Key read helper. Claims remain position-scoped so transaction gas stays bounded.
    function pendingKeyReward(address account, address key) external view returns (uint256 amount) {
        uint256[] storage positionIds = accountKeyPositions[account][key];
        for (uint256 index; index < positionIds.length; ++index) {
            (, uint256 keyWeth) = pendingPositionRewards(positionIds[index]);
            amount += keyWeth;
        }
    }

    function termConfig(BondTerm term) public view returns (uint40 duration, uint16 multiplierBps) {
        if (term == BondTerm.THIRTY_DAYS) return (LOCK_DURATION, 10_000);
        if (term == BondTerm.NINETY_DAYS) return (LOCK_DURATION * 3, 12_500);
        return (LOCK_DURATION * 6, 15_000);
    }

    function currentEpoch() public view returns (uint40) {
        return uint40(block.timestamp / EPOCH_DURATION);
    }

    function latestCompletedEpoch() public view returns (uint40) {
        uint40 epoch = currentEpoch();
        if (epoch == 0) revert EpochNotComplete(0);
        return epoch - 1;
    }

    function epochStart(uint40 epoch) public pure returns (uint256) {
        return uint256(epoch) * EPOCH_DURATION;
    }

    function epochEnd(uint40 epoch) external pure returns (uint256) {
        return uint256(epoch + 1) * EPOCH_DURATION;
    }

    function rewardPerBaseUnitAtEpoch(uint40 epoch) external view returns (uint256) {
        return uint256(BPS) * rewardPerWeightAtEpoch[epoch] / PRECISION;
    }

    function keyRewardPerBaseUnitAtEpoch(address key, uint40 epoch) external view returns (uint256) {
        return uint256(BPS) * keyRewardPerWeightAtEpoch[key][epoch] / PRECISION;
    }

    function positionEligibleAt(uint256 positionId, uint40 epoch) external view returns (bool) {
        BondPosition storage position = positions[positionId];
        return position.account != address(0) && epoch >= position.firstEligibleEpoch
            && epoch < position.lastEligibleEpochExclusive;
    }

    function getPosition(uint256 positionId) external view returns (BondPosition memory) {
        return positions[positionId];
    }

    function accountPositionCount(address account) external view returns (uint256) {
        return accountPositions[account].length;
    }

    function accountPositionAt(address account, uint256 index) external view returns (uint256) {
        return accountPositions[account][index];
    }

    function keyPositionCount(address account, address key) external view returns (uint256) {
        return accountKeyPositions[account][key].length;
    }

    function keyPositionAt(address account, address key, uint256 index) external view returns (uint256) {
        return accountKeyPositions[account][key][index];
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

    function _bond(address account, address key, uint256 units, BondTerm term, bool fromMeasuredPurchase)
        private
        returns (uint256 positionId)
    {
        if (units == 0 || units > type(uint128).max) revert InvalidAmount();
        if (!_approvedAgentKey(key)) revert InvalidAgentKey();

        uint256 committed = unitsByKey[account][key];
        uint256 bound = IAgentKeyBinding(key).boundBalance(account);
        uint256 available = bound > committed ? bound - committed : 0;
        if (available < units) revert MissingBoundKeys(available, units);

        (uint40 duration, uint16 multiplierBps) = termConfig(term);
        uint40 bondedAt = uint40(block.timestamp);
        uint40 maturesAt = bondedAt + MATURATION_DURATION;
        uint40 unlockAt = bondedAt + duration;
        uint40 firstEligibleEpoch = uint40((uint256(maturesAt) + EPOCH_DURATION - 1) / EPOCH_DURATION);
        uint40 lastEligibleEpochExclusive = uint40(uint256(unlockAt) / EPOCH_DURATION);
        if (firstEligibleEpoch >= lastEligibleEpochExclusive) revert NoEligibleEpochs();
        uint256 rewardWeight = units * multiplierBps;
        if (rewardWeight > type(uint128).max) revert InvalidAmount();

        uint256 amount = units * UNIT_SIZE;
        if (!fromMeasuredPurchase) {
            uint256 balanceBefore = MUPPETS.balanceOf(address(this));
            MUPPETS.safeTransferFrom(account, address(this), amount);
            if (MUPPETS.balanceOf(address(this)) - balanceBefore != amount) revert ExactTransferRequired();
        }

        positionId = nextPositionId++;
        positions[positionId] = BondPosition({
            account: account,
            key: key,
            units: uint128(units),
            rewardWeight: uint128(rewardWeight),
            bondedAt: bondedAt,
            maturesAt: maturesAt,
            unlockAt: unlockAt,
            firstEligibleEpoch: firstEligibleEpoch,
            lastEligibleEpochExclusive: lastEligibleEpochExclusive,
            multiplierBps: multiplierBps,
            term: term,
            withdrawn: false
        });
        accountPositions[account].push(positionId);
        accountKeyPositions[account][key].push(positionId);
        unitsByKey[account][key] = committed + units;
        rewardUnits[account] += units;
        bondedBalance[account] += amount;
        totalRewardUnits += units;
        totalRewardUnitsByKey[key] += units;
        totalBondedMuppets += amount;
        if (unlockAt > lockedUntil[account][key]) lockedUntil[account][key] = unlockAt;

        for (uint40 epoch = firstEligibleEpoch; epoch < lastEligibleEpochExclusive; ++epoch) {
            totalRewardWeightAtEpoch[epoch] += rewardWeight;
            totalKeyRewardWeightAtEpoch[key][epoch] += rewardWeight;
        }

        emit Bonded(
            positionId,
            account,
            key,
            units,
            amount,
            term,
            multiplierBps,
            maturesAt,
            unlockAt,
            firstEligibleEpoch,
            lastEligibleEpochExclusive
        );
    }

    function _checkpointPositionRewards(uint256 positionId, BondPosition storage position)
        private
        returns (uint256 globalWeth, uint256 keyWeth)
    {
        uint256 weight = position.rewardWeight;
        for (uint40 epoch = position.firstEligibleEpoch; epoch < position.lastEligibleEpochExclusive; ++epoch) {
            uint256 globalEntitlement = weight * rewardPerWeightAtEpoch[epoch] / PRECISION;
            uint256 globalClaimed = globalRewardClaimedByEpoch[positionId][epoch];
            if (globalEntitlement > globalClaimed) {
                globalWeth += globalEntitlement - globalClaimed;
                globalRewardClaimedByEpoch[positionId][epoch] = globalEntitlement;
            }

            uint256 keyEntitlement = weight * keyRewardPerWeightAtEpoch[position.key][epoch] / PRECISION;
            uint256 keyClaimed = keyRewardClaimedByEpoch[positionId][epoch];
            if (keyEntitlement > keyClaimed) {
                keyWeth += keyEntitlement - keyClaimed;
                keyRewardClaimedByEpoch[positionId][epoch] = keyEntitlement;
            }
        }
    }

    function _receiveWeth(uint256 amount) private {
        uint256 balanceBefore = WETH.balanceOf(address(this));
        WETH.safeTransferFrom(msg.sender, address(this), amount);
        if (WETH.balanceOf(address(this)) - balanceBefore != amount) revert ExactTransferRequired();
    }

    function _requireCompletedEpoch(uint40 epoch) private view {
        if (epoch >= currentEpoch()) revert EpochNotComplete(epoch);
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
