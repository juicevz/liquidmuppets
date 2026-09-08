// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IWrappedRevenueToken is IERC20 {
    function deposit() external payable;
}

interface IMuppetAgentBondRewards {
    function rewardNotifier() external view returns (address);
    function latestCompletedEpoch() external view returns (uint40);
    function totalRewardWeightAtEpoch(uint40 epoch) external view returns (uint256);
    function totalKeyRewardWeightAtEpoch(address key, uint40 epoch) external view returns (uint256);
    function notifyReward(uint40 epoch, uint256 amount) external;
    function notifyKeyReward(address key, uint40 epoch, uint256 amount) external;
}

interface IMuppetBuybackVaultFunding {
    function revenueRouter() external view returns (address);
    function fundKey(address key) external payable;
}

/// @notice Records creator revenue and keeps legacy/global routing separate from exact-Key routing.
/// @dev Pons creator revenue and legacy Key fees use 50/30/20. V2 Key fees use 50/25/15/10.
contract MuppetRevenueRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint16 public constant BOND_REWARD_SHARE_BPS = 5_000;
    uint16 public constant STOCK_RESERVE_SHARE_BPS = 3_000;
    uint16 public constant OPERATIONS_SHARE_BPS = 2_000;
    uint16 public constant KEY_BOND_REWARD_SHARE_BPS = 5_000;
    uint16 public constant KEY_BUYBACK_SHARE_BPS = 2_500;
    uint16 public constant KEY_STOCK_RESERVE_SHARE_BPS = 1_500;
    uint16 public constant KEY_OPERATIONS_SHARE_BPS = 1_000;
    uint40 public constant ROUTE_INTERVAL = 7 days;

    struct KeyRevenueAccount {
        uint256 totalVolume;
        uint256 totalRevenue;
        uint256 totalRouted;
        uint256 totalBondRewardsAllocated;
        uint256 totalBondRewardsDelivered;
        uint256 totalBuybackRouted;
        uint256 totalStockReserveRouted;
        uint256 totalOperationsRouted;
        uint256 pendingBondRewardsNative;
        uint40 lastRouteAt;
    }

    address public immutable PONS_FEE_ESCROW;
    IWrappedRevenueToken public immutable WETH;
    IMuppetAgentBondRewards public immutable AGENT_BOND;
    IMuppetBuybackVaultFunding public immutable BUYBACK_VAULT;
    address payable public immutable STOCK_RESERVE;
    address payable public immutable OPERATIONS_TREASURY;

    mapping(address marketplace => bool allowed) public marketplaces;
    mapping(address marketplace => bool allowed) public keyMarketplaces;
    mapping(address key => KeyRevenueAccount account) private keyRevenueAccounts;
    uint256 public totalPonsRevenue;
    uint256 public totalMarketplaceRevenue;
    uint256 public totalLegacyMarketplaceRevenue;
    uint256 public totalKeyMarketplaceRevenue;
    uint256 public totalKeyMarketplaceVolume;
    uint256 public totalFundingReceived;
    uint256 public totalRevenueRouted;
    uint256 public totalGlobalRevenueRouted;
    uint256 public totalKeyRevenueRouted;
    uint256 public totalBondRewardsAllocated;
    uint256 public totalBondRewardsDelivered;
    uint256 public totalBuybackRouted;
    uint256 public totalStockReserveRouted;
    uint256 public totalOperationsRouted;
    uint256 public pendingBondRewardsNative;
    uint256 public withdrawableFunding;
    uint40 public lastRouteAt;

    event MarketplaceSet(address indexed marketplace, bool allowed);
    event KeyMarketplaceSet(address indexed marketplace, bool allowed);
    event RevenueReceived(bytes32 indexed source, address indexed sender, uint256 amount);
    event KeyRevenueRecorded(address indexed key, address indexed marketplace, uint256 grossVolume, uint256 fee);
    event FundingReceived(address indexed sender, uint256 amount);
    event PonsFeesClaimed(address indexed caller, uint256 amount);
    event RevenueRouted(
        address indexed caller, uint256 amount, uint256 bondRewards, uint256 stockReserve, uint256 operations
    );
    event KeyRevenueRouted(
        address indexed key,
        address indexed caller,
        uint256 amount,
        uint256 bondRewards,
        uint256 buyback,
        uint256 stockReserve,
        uint256 operations
    );
    event BondRewardsQueued(uint256 amount, uint256 pendingTotal);
    event KeyBondRewardsQueued(address indexed key, uint256 amount, uint256 pendingTotal);
    event BondRewardsDelivered(uint40 indexed epoch, uint256 amount, uint256 totalWeight);
    event KeyBondRewardsDelivered(address indexed key, uint40 indexed epoch, uint256 amount, uint256 totalWeight);
    event FundingWithdrawn(address indexed receiver, uint256 amount);
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);

    error AddressZero();
    error ContractGovernanceRequired();
    error InvalidAmount();
    error NoRewardUnits();
    error NoRevenue();
    error NotKeyMarketplace();
    error OwnershipRenunciationDisabled();
    error PaymentFailed();
    error PonsClaimFailed();
    error RouteCooldown(uint256 nextRouteAt);
    error UnsafeActivation();

    constructor(
        address initialOwner,
        address ponsFeeEscrow,
        IWrappedRevenueToken weth,
        IMuppetAgentBondRewards agentBond,
        IMuppetBuybackVaultFunding buybackVault,
        address payable stockReserve,
        address payable operationsTreasury
    ) Ownable(initialOwner) {
        if (
            ponsFeeEscrow == address(0) || address(weth) == address(0) || address(agentBond) == address(0)
                || address(buybackVault) == address(0) || stockReserve == address(0) || operationsTreasury == address(0)
        ) revert AddressZero();
        if (
            ponsFeeEscrow.code.length == 0 || address(weth).code.length == 0 || address(agentBond).code.length == 0
                || address(buybackVault).code.length == 0 || stockReserve.code.length == 0
                || operationsTreasury.code.length == 0
        ) revert AddressZero();
        PONS_FEE_ESCROW = ponsFeeEscrow;
        WETH = weth;
        AGENT_BOND = agentBond;
        BUYBACK_VAULT = buybackVault;
        STOCK_RESERVE = stockReserve;
        OPERATIONS_TREASURY = operationsTreasury;
        _pause();
    }

    receive() external payable {
        if (msg.sender == PONS_FEE_ESCROW) {
            totalPonsRevenue += msg.value;
            emit RevenueReceived(keccak256("PONS_CREATOR_FEES"), msg.sender, msg.value);
        } else if (marketplaces[msg.sender]) {
            totalMarketplaceRevenue += msg.value;
            totalLegacyMarketplaceRevenue += msg.value;
            emit RevenueReceived(keccak256("LEGACY_AGENT_KEY_MARKET_FEES"), msg.sender, msg.value);
        } else {
            totalFundingReceived += msg.value;
            withdrawableFunding += msg.value;
            emit FundingReceived(msg.sender, msg.value);
        }
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

    function setMarketplace(address marketplace, bool allowed) external onlyOwner whenPaused {
        if (marketplace == address(0) || (allowed && marketplace.code.length == 0)) revert AddressZero();
        marketplaces[marketplace] = allowed;
        emit MarketplaceSet(marketplace, allowed);
    }

    function setKeyMarketplace(address marketplace, bool allowed) external onlyOwner whenPaused {
        if (marketplace == address(0) || (allowed && marketplace.code.length == 0)) revert AddressZero();
        keyMarketplaces[marketplace] = allowed;
        emit KeyMarketplaceSet(marketplace, allowed);
    }

    function activate() external onlyOwner {
        if (
            !governanceReady() || AGENT_BOND.rewardNotifier() != address(this)
                || BUYBACK_VAULT.revenueRouter() != address(this)
        ) revert UnsafeActivation();
        _unpause();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function fund() external payable {
        if (msg.value == 0) revert InvalidAmount();
        totalFundingReceived += msg.value;
        withdrawableFunding += msg.value;
        emit FundingReceived(msg.sender, msg.value);
    }

    function recordKeyMarketplaceRevenue(address key, uint256 grossVolume) external payable whenNotPaused {
        if (!keyMarketplaces[msg.sender]) revert NotKeyMarketplace();
        if (key == address(0) || grossVolume == 0 || msg.value == 0) revert InvalidAmount();
        KeyRevenueAccount storage account = keyRevenueAccounts[key];
        account.totalVolume += grossVolume;
        account.totalRevenue += msg.value;
        totalMarketplaceRevenue += msg.value;
        totalKeyMarketplaceRevenue += msg.value;
        totalKeyMarketplaceVolume += grossVolume;
        emit KeyRevenueRecorded(key, msg.sender, grossVolume, msg.value);
    }

    function claimPonsFees() external nonReentrant returns (uint256 amount) {
        uint256 beforeBalance = address(this).balance;
        (bool ok,) = PONS_FEE_ESCROW.call(abi.encodeWithSignature("claim()"));
        if (!ok) revert PonsClaimFailed();
        amount = address(this).balance - beforeBalance;
        if (amount == 0) revert NoRevenue();
        emit PonsFeesClaimed(msg.sender, amount);
    }

    function unroutedRevenue() public view returns (uint256) {
        return totalPonsRevenue + totalLegacyMarketplaceRevenue - totalGlobalRevenueRouted;
    }

    function keyUnroutedRevenue(address key) public view returns (uint256) {
        KeyRevenueAccount storage account = keyRevenueAccounts[key];
        return account.totalRevenue - account.totalRouted;
    }

    function keyRevenueState(address key) external view returns (KeyRevenueAccount memory) {
        return keyRevenueAccounts[key];
    }

    function routeRevenue()
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amount, uint256 bondRewards, uint256 stockReserve, uint256 operations)
    {
        amount = unroutedRevenue();
        if (amount == 0) revert NoRevenue();
        uint40 previousRouteAt = lastRouteAt;
        if (previousRouteAt != 0 && block.timestamp < uint256(previousRouteAt) + ROUTE_INTERVAL) {
            revert RouteCooldown(uint256(previousRouteAt) + ROUTE_INTERVAL);
        }

        bondRewards = amount * BOND_REWARD_SHARE_BPS / BPS;
        stockReserve = amount * STOCK_RESERVE_SHARE_BPS / BPS;
        operations = amount - bondRewards - stockReserve;
        totalGlobalRevenueRouted += amount;
        totalRevenueRouted += amount;
        totalBondRewardsAllocated += bondRewards;
        totalStockReserveRouted += stockReserve;
        totalOperationsRouted += operations;
        lastRouteAt = uint40(block.timestamp);

        uint40 epoch = AGENT_BOND.latestCompletedEpoch();
        uint256 weight = AGENT_BOND.totalRewardWeightAtEpoch(epoch);
        if (weight == 0) {
            pendingBondRewardsNative += bondRewards;
            emit BondRewardsQueued(bondRewards, pendingBondRewardsNative);
        } else {
            uint256 rewardAmount = bondRewards + pendingBondRewardsNative;
            pendingBondRewardsNative = 0;
            _deliverBondRewards(epoch, rewardAmount, weight);
        }

        _pay(STOCK_RESERVE, stockReserve);
        _pay(OPERATIONS_TREASURY, operations);
        emit RevenueRouted(msg.sender, amount, bondRewards, stockReserve, operations);
    }

    function routeKeyRevenue(address key)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amount, uint256 bondRewards, uint256 buyback, uint256 stockReserve, uint256 operations)
    {
        KeyRevenueAccount storage account = keyRevenueAccounts[key];
        amount = account.totalRevenue - account.totalRouted;
        if (amount == 0) revert NoRevenue();
        uint40 previousRouteAt = account.lastRouteAt;
        if (previousRouteAt != 0 && block.timestamp < uint256(previousRouteAt) + ROUTE_INTERVAL) {
            revert RouteCooldown(uint256(previousRouteAt) + ROUTE_INTERVAL);
        }

        bondRewards = amount * KEY_BOND_REWARD_SHARE_BPS / BPS;
        buyback = amount * KEY_BUYBACK_SHARE_BPS / BPS;
        stockReserve = amount * KEY_STOCK_RESERVE_SHARE_BPS / BPS;
        operations = amount - bondRewards - buyback - stockReserve;
        account.totalRouted += amount;
        account.totalBondRewardsAllocated += bondRewards;
        account.totalBuybackRouted += buyback;
        account.totalStockReserveRouted += stockReserve;
        account.totalOperationsRouted += operations;
        account.lastRouteAt = uint40(block.timestamp);
        totalRevenueRouted += amount;
        totalKeyRevenueRouted += amount;
        totalBondRewardsAllocated += bondRewards;
        totalBuybackRouted += buyback;
        totalStockReserveRouted += stockReserve;
        totalOperationsRouted += operations;

        uint40 epoch = AGENT_BOND.latestCompletedEpoch();
        uint256 weight = AGENT_BOND.totalKeyRewardWeightAtEpoch(key, epoch);
        if (weight == 0) {
            account.pendingBondRewardsNative += bondRewards;
            emit KeyBondRewardsQueued(key, bondRewards, account.pendingBondRewardsNative);
        } else {
            uint256 rewardAmount = bondRewards + account.pendingBondRewardsNative;
            account.pendingBondRewardsNative = 0;
            _deliverKeyBondRewards(key, epoch, rewardAmount, weight, account);
        }

        if (buyback != 0) BUYBACK_VAULT.fundKey{value: buyback}(key);
        _pay(STOCK_RESERVE, stockReserve);
        _pay(OPERATIONS_TREASURY, operations);
        emit KeyRevenueRouted(key, msg.sender, amount, bondRewards, buyback, stockReserve, operations);
    }

    function releasePendingBondRewards() external nonReentrant whenNotPaused returns (uint256 amount) {
        uint40 epoch = AGENT_BOND.latestCompletedEpoch();
        uint256 weight = AGENT_BOND.totalRewardWeightAtEpoch(epoch);
        if (weight == 0) revert NoRewardUnits();
        amount = pendingBondRewardsNative;
        if (amount == 0) revert NoRevenue();
        pendingBondRewardsNative = 0;
        _deliverBondRewards(epoch, amount, weight);
    }

    function releasePendingKeyBondRewards(address key) external nonReentrant whenNotPaused returns (uint256 amount) {
        uint40 epoch = AGENT_BOND.latestCompletedEpoch();
        uint256 weight = AGENT_BOND.totalKeyRewardWeightAtEpoch(key, epoch);
        if (weight == 0) revert NoRewardUnits();
        KeyRevenueAccount storage account = keyRevenueAccounts[key];
        amount = account.pendingBondRewardsNative;
        if (amount == 0) revert NoRevenue();
        account.pendingBondRewardsNative = 0;
        _deliverKeyBondRewards(key, epoch, amount, weight, account);
    }

    function withdrawFunding(address payable receiver, uint256 amount) external onlyOwner nonReentrant whenPaused {
        if (receiver == address(0)) revert AddressZero();
        if (amount == 0 || amount > withdrawableFunding) revert InvalidAmount();
        withdrawableFunding -= amount;
        _pay(receiver, amount);
        emit FundingWithdrawn(receiver, amount);
    }

    function rescueToken(IERC20 token, address receiver, uint256 amount) external onlyOwner nonReentrant whenPaused {
        if (address(token) == address(0) || receiver == address(0)) revert AddressZero();
        token.safeTransfer(receiver, amount);
        emit TokenRescued(address(token), receiver, amount);
    }

    function _deliverBondRewards(uint40 epoch, uint256 amount, uint256 weight) private {
        if (amount == 0) return;
        WETH.deposit{value: amount}();
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), amount);
        AGENT_BOND.notifyReward(epoch, amount);
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), 0);
        totalBondRewardsDelivered += amount;
        emit BondRewardsDelivered(epoch, amount, weight);
    }

    function _deliverKeyBondRewards(
        address key,
        uint40 epoch,
        uint256 amount,
        uint256 weight,
        KeyRevenueAccount storage account
    ) private {
        if (amount == 0) return;
        WETH.deposit{value: amount}();
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), amount);
        AGENT_BOND.notifyKeyReward(key, epoch, amount);
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), 0);
        account.totalBondRewardsDelivered += amount;
        totalBondRewardsDelivered += amount;
        emit KeyBondRewardsDelivered(key, epoch, amount, weight);
    }

    function _pay(address payable receiver, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }
}
