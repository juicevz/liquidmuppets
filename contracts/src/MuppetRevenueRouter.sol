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
    function totalRewardUnits() external view returns (uint256);
    function notifyReward(uint256 amount) external;
}

/// @notice Records creator revenue by source and routes it with immutable 50/30/20 accounting.
/// @dev The external Pons protocol and buyback portions are removed before creator revenue reaches this contract.
contract MuppetRevenueRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint16 public constant BOND_REWARD_SHARE_BPS = 5_000;
    uint16 public constant STOCK_RESERVE_SHARE_BPS = 3_000;
    uint16 public constant OPERATIONS_SHARE_BPS = 2_000;
    uint40 public constant ROUTE_INTERVAL = 7 days;

    address public immutable PONS_FEE_ESCROW;
    IWrappedRevenueToken public immutable WETH;
    IMuppetAgentBondRewards public immutable AGENT_BOND;
    address payable public immutable STOCK_RESERVE;
    address payable public immutable OPERATIONS_TREASURY;

    mapping(address marketplace => bool allowed) public marketplaces;
    uint256 public totalPonsRevenue;
    uint256 public totalMarketplaceRevenue;
    uint256 public totalFundingReceived;
    uint256 public totalRevenueRouted;
    uint256 public totalBondRewardsAllocated;
    uint256 public totalBondRewardsDelivered;
    uint256 public totalStockReserveRouted;
    uint256 public totalOperationsRouted;
    uint256 public pendingBondRewardsNative;
    uint256 public withdrawableFunding;
    uint40 public lastRouteAt;

    event MarketplaceSet(address indexed marketplace, bool allowed);
    event RevenueReceived(bytes32 indexed source, address indexed sender, uint256 amount);
    event FundingReceived(address indexed sender, uint256 amount);
    event PonsFeesClaimed(address indexed caller, uint256 amount);
    event RevenueRouted(
        address indexed caller, uint256 amount, uint256 bondRewards, uint256 stockReserve, uint256 operations
    );
    event BondRewardsQueued(uint256 amount, uint256 pendingTotal);
    event BondRewardsDelivered(uint256 amount, uint256 totalUnits);
    event FundingWithdrawn(address indexed receiver, uint256 amount);
    event TokenRescued(address indexed token, address indexed receiver, uint256 amount);

    error AddressZero();
    error ContractGovernanceRequired();
    error InvalidAmount();
    error NoRewardUnits();
    error NoRevenue();
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
        address payable stockReserve,
        address payable operationsTreasury
    ) Ownable(initialOwner) {
        if (
            ponsFeeEscrow == address(0) || address(weth) == address(0) || address(agentBond) == address(0)
                || stockReserve == address(0) || operationsTreasury == address(0)
        ) revert AddressZero();
        if (
            ponsFeeEscrow.code.length == 0 || address(weth).code.length == 0 || address(agentBond).code.length == 0
                || stockReserve.code.length == 0 || operationsTreasury.code.length == 0
        ) revert AddressZero();
        PONS_FEE_ESCROW = ponsFeeEscrow;
        WETH = weth;
        AGENT_BOND = agentBond;
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
            emit RevenueReceived(keccak256("AGENT_KEY_MARKET_FEES"), msg.sender, msg.value);
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

    function activate() external onlyOwner {
        if (!governanceReady() || AGENT_BOND.rewardNotifier() != address(this)) revert UnsafeActivation();
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

    /// @notice Claims native creator fees after the Pons fee recipient has been set to this router.
    function claimPonsFees() external nonReentrant returns (uint256 amount) {
        uint256 beforeBalance = address(this).balance;
        (bool ok,) = PONS_FEE_ESCROW.call(abi.encodeWithSignature("claim()"));
        if (!ok) revert PonsClaimFailed();
        amount = address(this).balance - beforeBalance;
        if (amount == 0) revert NoRevenue();
        emit PonsFeesClaimed(msg.sender, amount);
    }

    function unroutedRevenue() public view returns (uint256) {
        return totalPonsRevenue + totalMarketplaceRevenue - totalRevenueRouted;
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
        totalRevenueRouted += amount;
        totalBondRewardsAllocated += bondRewards;
        totalStockReserveRouted += stockReserve;
        totalOperationsRouted += operations;
        lastRouteAt = uint40(block.timestamp);

        uint256 units = AGENT_BOND.totalRewardUnits();
        if (units == 0) {
            pendingBondRewardsNative += bondRewards;
            emit BondRewardsQueued(bondRewards, pendingBondRewardsNative);
        } else {
            uint256 rewardAmount = bondRewards + pendingBondRewardsNative;
            pendingBondRewardsNative = 0;
            _deliverBondRewards(rewardAmount, units);
        }

        _pay(STOCK_RESERVE, stockReserve);
        _pay(OPERATIONS_TREASURY, operations);
        emit RevenueRouted(msg.sender, amount, bondRewards, stockReserve, operations);
    }

    function releasePendingBondRewards() external nonReentrant whenNotPaused returns (uint256 amount) {
        uint256 units = AGENT_BOND.totalRewardUnits();
        if (units == 0) revert NoRewardUnits();
        amount = pendingBondRewardsNative;
        if (amount == 0) revert NoRevenue();
        pendingBondRewardsNative = 0;
        _deliverBondRewards(amount, units);
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

    function _deliverBondRewards(uint256 amount, uint256 units) private {
        if (amount == 0) return;
        WETH.deposit{value: amount}();
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), amount);
        AGENT_BOND.notifyReward(amount);
        IERC20(address(WETH)).forceApprove(address(AGENT_BOND), 0);
        totalBondRewardsDelivered += amount;
        emit BondRewardsDelivered(amount, units);
    }

    function _pay(address payable receiver, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = receiver.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }
}
