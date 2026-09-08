// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMuppetsBuybackExecutor {
    function MUPPETS() external view returns (IERC20);
    function executeBuy(uint256 minimumOutput, uint256 deadline, address recipient)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Holds Key-specific buyback budgets and vests every purchased MUPPETS lot for five years.
contract MuppetBuybackVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint40 public constant VESTING_DURATION = 5 * 365 days;
    uint256 public constant MAX_RELEASE_LOTS = 100;
    uint256 public constant MIN_BUYBACK_WEI = 0.0001 ether;
    uint256 public constant ABSOLUTE_MAX_BUYBACK_WEI = 0.01 ether;
    uint40 public constant MIN_BUYBACK_COOLDOWN = 30 minutes;

    struct VestingLot {
        uint128 amount;
        uint128 released;
        uint40 start;
    }

    IERC20 public immutable MUPPETS;
    IMuppetsBuybackExecutor public immutable EXECUTOR;
    address public immutable BENEFICIARY;

    address public revenueRouter;
    uint256 public maxBuybackWei;
    uint40 public buybackCooldown;
    uint256 public totalPendingNative;
    uint256 public totalFundedNative;
    uint256 public totalSpentNative;
    uint256 public totalMuppetsPurchased;
    uint256 public totalMuppetsReleased;
    uint256 public keeperCount;

    mapping(address keeper => bool allowed) public keepers;
    mapping(address key => uint256 amount) public pendingNativeByKey;
    mapping(address key => uint256 amount) public totalFundedByKey;
    mapping(address key => uint256 amount) public totalSpentByKey;
    mapping(address key => uint256 amount) public totalMuppetsPurchasedByKey;
    mapping(address key => uint40 timestamp) public lastBuybackAt;
    VestingLot[] private vestingLots;

    event RevenueRouterSet(address indexed router);
    event KeeperSet(address indexed keeper, bool allowed);
    event LimitsSet(uint256 maxBuybackWei, uint40 buybackCooldown);
    event KeyFunded(address indexed key, uint256 amount, uint256 pendingForKey);
    event KeyBuybackExecuted(
        address indexed key,
        address indexed keeper,
        uint256 nativeSpent,
        uint256 muppetsPurchased,
        uint256 minimumOutput
    );
    event MuppetsReleased(address indexed beneficiary, uint256 amount);
    event ExcessNativeRecovered(address indexed receiver, uint256 amount);
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);

    error AddressZero();
    error ContractGovernanceRequired();
    error ContractRequired();
    error InvalidAmount();
    error NoTokensDue();
    error NotKeeper();
    error NotRevenueRouter();
    error OwnershipRenunciationDisabled();
    error PaymentFailed();
    error PurchaseCooldown(uint256 nextPurchaseAt);
    error UnsafeActivation();

    constructor(
        address initialOwner,
        IMuppetsBuybackExecutor executor,
        address beneficiary,
        uint256 initialMaxBuybackWei,
        uint40 initialBuybackCooldown
    ) Ownable(initialOwner) {
        if (address(executor) == address(0) || beneficiary == address(0)) revert AddressZero();
        if (address(executor).code.length == 0 || beneficiary.code.length == 0) revert ContractRequired();
        if (
            initialMaxBuybackWei < MIN_BUYBACK_WEI || initialMaxBuybackWei > ABSOLUTE_MAX_BUYBACK_WEI
                || initialBuybackCooldown < MIN_BUYBACK_COOLDOWN
        ) revert InvalidAmount();
        EXECUTOR = executor;
        MUPPETS = executor.MUPPETS();
        BENEFICIARY = beneficiary;
        maxBuybackWei = initialMaxBuybackWei;
        buybackCooldown = initialBuybackCooldown;
        _pause();
    }

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert NotKeeper();
        _;
    }

    modifier onlyRevenueRouter() {
        if (msg.sender != revenueRouter) revert NotRevenueRouter();
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

    function setRevenueRouter(address router) external onlyOwner whenPaused {
        if (router == address(0) || router.code.length == 0) revert ContractRequired();
        revenueRouter = router;
        emit RevenueRouterSet(router);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner whenPaused {
        if (keeper == address(0)) revert AddressZero();
        if (allowed && !keepers[keeper]) keeperCount += 1;
        if (!allowed && keepers[keeper]) keeperCount -= 1;
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setLimits(uint256 nextMaxBuybackWei, uint40 nextBuybackCooldown) external onlyOwner whenPaused {
        if (
            nextMaxBuybackWei < MIN_BUYBACK_WEI || nextMaxBuybackWei > ABSOLUTE_MAX_BUYBACK_WEI
                || nextBuybackCooldown < MIN_BUYBACK_COOLDOWN
        ) revert InvalidAmount();
        maxBuybackWei = nextMaxBuybackWei;
        buybackCooldown = nextBuybackCooldown;
        emit LimitsSet(nextMaxBuybackWei, nextBuybackCooldown);
    }

    function activate() external onlyOwner {
        if (!governanceReady() || revenueRouter == address(0) || !_hasKeeper()) revert UnsafeActivation();
        _unpause();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function fundKey(address key) external payable onlyRevenueRouter {
        if (key == address(0) || msg.value == 0) revert InvalidAmount();
        pendingNativeByKey[key] += msg.value;
        totalPendingNative += msg.value;
        totalFundedByKey[key] += msg.value;
        totalFundedNative += msg.value;
        emit KeyFunded(key, msg.value, pendingNativeByKey[key]);
    }

    function executeKeyBuyback(address key, uint256 amount, uint256 minimumOutput, uint256 deadline)
        external
        nonReentrant
        whenNotPaused
        onlyKeeper
        returns (uint256 purchased)
    {
        if (
            amount < MIN_BUYBACK_WEI || amount > maxBuybackWei || amount > pendingNativeByKey[key] || minimumOutput == 0
        ) {
            revert InvalidAmount();
        }
        uint40 previous = lastBuybackAt[key];
        if (previous != 0 && block.timestamp < uint256(previous) + buybackCooldown) {
            revert PurchaseCooldown(uint256(previous) + buybackCooldown);
        }

        pendingNativeByKey[key] -= amount;
        totalPendingNative -= amount;
        totalSpentByKey[key] += amount;
        totalSpentNative += amount;
        lastBuybackAt[key] = uint40(block.timestamp);
        purchased = EXECUTOR.executeBuy{value: amount}(minimumOutput, deadline, address(this));
        if (purchased == 0 || purchased > type(uint128).max) revert InvalidAmount();
        totalMuppetsPurchasedByKey[key] += purchased;
        totalMuppetsPurchased += purchased;
        vestingLots.push(VestingLot(uint128(purchased), 0, uint40(block.timestamp)));
        emit KeyBuybackExecuted(key, msg.sender, amount, purchased, minimumOutput);
    }

    function releasableMuppets(uint256 start, uint256 count) public view returns (uint256 amount) {
        uint256 end = _pageEnd(start, count);
        for (uint256 index = start; index < end; ++index) {
            VestingLot memory lot = vestingLots[index];
            uint256 vested = _vested(lot);
            amount += vested - lot.released;
        }
    }

    /// @notice Releases vested lots in bounded pages so a large market cannot make release run out of gas.
    function releaseMuppets(uint256 start, uint256 count) external nonReentrant returns (uint256 amount) {
        uint256 end = _pageEnd(start, count);
        for (uint256 index = start; index < end; ++index) {
            VestingLot storage lot = vestingLots[index];
            uint256 vested = _vested(lot);
            uint256 due = vested - lot.released;
            if (due != 0) {
                lot.released += uint128(due);
                amount += due;
            }
        }
        if (amount == 0) revert NoTokensDue();
        totalMuppetsReleased += amount;
        MUPPETS.safeTransfer(BENEFICIARY, amount);
        emit MuppetsReleased(BENEFICIARY, amount);
    }

    function vestingLotCount() external view returns (uint256) {
        return vestingLots.length;
    }

    function vestingLotAt(uint256 index) external view returns (VestingLot memory) {
        return vestingLots[index];
    }

    function recoverExcessNative(address payable receiver, uint256 amount) external onlyOwner nonReentrant whenPaused {
        if (receiver == address(0) || amount == 0 || amount > address(this).balance - totalPendingNative) {
            revert InvalidAmount();
        }
        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert PaymentFailed();
        emit ExcessNativeRecovered(receiver, amount);
    }

    function rescueToken(IERC20 token, address receiver, uint256 amount) external onlyOwner nonReentrant whenPaused {
        if (address(token) == address(0) || address(token) == address(MUPPETS) || receiver == address(0)) {
            revert InvalidAmount();
        }
        token.safeTransfer(receiver, amount);
        emit TokenRescued(address(token), receiver, amount);
    }

    function _vested(VestingLot memory lot) private view returns (uint256) {
        uint256 elapsed = block.timestamp - lot.start;
        if (elapsed >= VESTING_DURATION) return lot.amount;
        return uint256(lot.amount) * elapsed / VESTING_DURATION;
    }

    function _pageEnd(uint256 start, uint256 count) private view returns (uint256 end) {
        uint256 length = vestingLots.length;
        if (start >= length || count == 0 || count > MAX_RELEASE_LOTS) revert InvalidAmount();
        end = start + count;
        if (end > length) end = length;
    }

    function _hasKeeper() private view returns (bool) {
        return keeperCount != 0;
    }
}
