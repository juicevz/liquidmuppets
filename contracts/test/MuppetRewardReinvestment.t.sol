// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {IMuppetRewardBuyExecutor, MuppetAgentBond} from "../src/MuppetAgentBond.sol";
import {MockWrappedRevenueToken, RevenueGovernanceHarness} from "./MuppetRevenue.t.sol";

contract ReinvestmentKeyRegistry {
    mapping(address => bool) public approvedKeys;

    function register(address key) external {
        approvedKeys[key] = true;
    }
}

contract ReinvestmentBuyExecutor {
    MockERC20 public immutable MUPPETS;
    uint256 public output = 16_000 ether;
    uint256 public nativeSpent;
    address public recipient;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes4 public callbackError;

    constructor(MockERC20 muppets) {
        MUPPETS = muppets;
    }

    function setOutput(uint256 amount) external {
        output = amount;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function executeBuy(uint256, uint256, address to) external payable returns (uint256) {
        nativeSpent += msg.value;
        recipient = to;
        if (callbackTarget != address(0)) {
            bytes memory result;
            (callbackSucceeded, result) = callbackTarget.call(callbackData);
            if (result.length >= 4) callbackError = bytes4(result);
        }
        MUPPETS.mint(to, output);
        // Deliberately wrong return value: the Bond must use its measured token delta.
        return type(uint256).max;
    }
}

contract MuppetRewardReinvestmentTest is Test {
    address internal constant DEV = 0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f;
    uint256 internal constant UNIT = 15_000 ether;
    MockERC20 internal muppets;
    MockWrappedRevenueToken internal weth;
    ReinvestmentBuyExecutor internal executor;
    ReinvestmentKeyRegistry internal registry;
    RevenueGovernanceHarness internal governance;
    AgentKey internal key;
    MuppetAgentBond internal bond;
    uint256 internal originalPosition;

    function setUp() public {
        vm.warp(200 * 7 days + 1 days);
        muppets = new MockERC20("Muppets", "MUPPETS", 18, 0);
        weth = new MockWrappedRevenueToken();
        executor = new ReinvestmentBuyExecutor(muppets);
        registry = new ReinvestmentKeyRegistry();
        governance = new RevenueGovernanceHarness();
        key = new AgentKey("Dev Test Key", "DEVKEY", DEV, 100);
        registry.register(address(key));
        bond = new MuppetAgentBond(
            address(this), muppets, weth, UNIT, 30 days, IMuppetRewardBuyExecutor(address(executor))
        );
        bond.setKeyRegistry(address(registry), true);
        bond.setRewardNotifier(address(this));
        bond.transferOwnership(address(governance));
        governance.execute(address(bond), abi.encodeCall(MuppetAgentBond.activate, ()));

        muppets.mint(DEV, 60_000 ether);
        vm.startPrank(DEV);
        key.bind(4);
        muppets.approve(address(bond), UNIT);
        originalPosition = bond.bond(address(key), 1);
        vm.stopPrank();
        MuppetAgentBond.BondPosition memory position = bond.getPosition(originalPosition);
        vm.warp(bond.epochStart(position.firstEligibleEpoch + 1));

        vm.deal(address(this), 10 ether);
        weth.deposit{value: 3 ether}();
        weth.approve(address(bond), 3 ether);
        bond.notifyReward(position.firstEligibleEpoch, 2 ether);
        bond.notifyKeyReward(address(key), position.firstEligibleEpoch, 1 ether);
    }

    function testDevCanClaimBuyAndBondPartialRewardsWithoutAllowance() public {
        uint256 beforeUnlock = bond.getPosition(originalPosition).unlockAt;
        uint256 beforeBalance = muppets.balanceOf(DEV);
        assertEq(muppets.allowance(DEV, address(bond)), 0);
        vm.prank(DEV);
        (uint256 created, uint256 bought, uint256 globalClaimed, uint256 keyClaimed) = bond.claimBuyAndBond(
            originalPosition,
            1 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.NINETY_DAYS,
            UNIT,
            block.timestamp + 1 minutes
        );

        assertEq(created, 2);
        assertEq(bought, 16_000 ether);
        assertEq(globalClaimed, 2 ether);
        assertEq(keyClaimed, 1 ether);
        assertEq(muppets.balanceOf(DEV), beforeBalance + 1_000 ether);
        assertEq(weth.balanceOf(DEV), 2 ether);
        assertEq(executor.nativeSpent(), 1 ether);
        assertEq(executor.recipient(), address(bond));
        assertEq(bond.getPosition(originalPosition).unlockAt, beforeUnlock);
        MuppetAgentBond.BondPosition memory position = bond.getPosition(created);
        assertEq(position.account, DEV);
        assertEq(position.key, address(key));
        assertEq(position.units, 1);
        assertEq(position.unlockAt, block.timestamp + 90 days);
        assertEq(position.maturesAt, block.timestamp + 7 days);
        assertEq(position.multiplierBps, 12_500);
        assertEq(bond.pendingTotalReward(DEV), 0);
        assertEq(bond.rewardLiability(), 0);
        assertEq(bond.keyRewardLiability(address(key)), 0);
        assertEq(bond.totalRewardsClaimed(), 3 ether);
        assertEq(bond.totalBondedMuppets(), 2 * UNIT);
        assertEq(muppets.balanceOf(address(bond)), 2 * UNIT);
        assertEq(address(bond).balance, 0);
    }

    function testDevCanSpendAllClaimedRewardsAndBondTwoUnits() public {
        executor.setOutput(2 * UNIT);
        vm.prank(DEV);
        (uint256 created,,,) = bond.claimBuyAndBond(
            originalPosition,
            3 ether,
            address(key),
            2,
            MuppetAgentBond.BondTerm.ONE_EIGHTY_DAYS,
            2 * UNIT,
            block.timestamp + 5 minutes
        );
        assertEq(bond.getPosition(created).units, 2);
        assertEq(bond.getPosition(created).multiplierBps, 15_000);
        assertEq(weth.balanceOf(DEV), 0);
        assertEq(muppets.balanceOf(DEV), 45_000 ether);
        assertEq(bond.bondedBalance(DEV), 3 * UNIT);
    }

    function testFuzzDevReceivesEveryUnspentRewardWei(uint96 proposedSpend) public {
        uint256 spend = bound(uint256(proposedSpend), 1, 3 ether);
        _reinvest(spend, UNIT, block.timestamp + 1 minutes);
        assertEq(weth.balanceOf(DEV), 3 ether - spend);
        assertEq(executor.nativeSpent(), spend);
        assertEq(weth.balanceOf(address(bond)), 0);
    }

    function testStrayTokensAndNativeFundsAreNotReinvested() public {
        muppets.mint(address(bond), 123 ether);
        weth.deposit{value: 0.5 ether}();
        weth.transfer(address(bond), 0.5 ether);
        vm.deal(address(bond), 0.25 ether);
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        assertEq(muppets.balanceOf(address(bond)), 2 * UNIT + 123 ether);
        assertEq(weth.balanceOf(address(bond)), 0.5 ether);
        assertEq(address(bond).balance, 0.25 ether);
    }

    function testZeroSpendRejectedAndRewardsRemainClaimable() public {
        vm.expectRevert(MuppetAgentBond.InvalidAmount.selector);
        _reinvest(0, UNIT, block.timestamp + 1 minutes);
        _assertUntouched();
    }

    function testCannotSpendWalletWethBeyondClaimedPositionRewards() public {
        weth.deposit{value: 1 ether}();
        weth.transfer(DEV, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.RewardSpendExceeded.selector, 3 ether, 4 ether));
        _reinvest(4 ether, UNIT, block.timestamp + 1 minutes);
        _assertUntouched();
        assertEq(weth.balanceOf(DEV), 1 ether);
    }

    function testCannotSpendRewardsFromADifferentPosition() public {
        vm.startPrank(DEV);
        muppets.approve(address(bond), UNIT);
        uint256 anotherPosition = bond.bond(address(key), 1);
        vm.stopPrank();
        uint40 anotherEpoch = bond.getPosition(anotherPosition).firstEligibleEpoch;
        vm.warp(bond.epochStart(anotherEpoch + 1));
        weth.deposit{value: 0.5 ether}();
        weth.approve(address(bond), 0.5 ether);
        bond.notifyReward(anotherEpoch, 0.5 ether);
        assertEq(bond.pendingTotalReward(DEV), 3.5 ether);

        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.RewardSpendExceeded.selector, 3 ether, 3.5 ether));
        _reinvest(3.5 ether, UNIT, block.timestamp + 1 minutes);
        assertEq(bond.pendingTotalReward(DEV), 3.5 ether);
        assertEq(weth.balanceOf(address(bond)), 3.5 ether);
        assertEq(bond.totalRewardsClaimed(), 0);
        assertEq(executor.nativeSpent(), 0);
    }

    function testExpiredAndOverlongDeadlinesRejected() public {
        vm.expectRevert(MuppetAgentBond.DeadlineInvalid.selector);
        _reinvest(1 ether, UNIT, block.timestamp - 1);
        vm.expectRevert(MuppetAgentBond.DeadlineInvalid.selector);
        _reinvest(1 ether, UNIT, block.timestamp + 5 minutes + 1);
        _assertUntouched();
    }

    function testMinimumMustCoverEntireFreshBond() public {
        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.InsufficientBoughtMuppets.selector, UNIT - 1, UNIT));
        _reinvest(1 ether, UNIT - 1, block.timestamp + 1 minutes);
        _assertUntouched();
    }

    function testMeasuredSlippageFailureRollsBackClaimAndPurchase() public {
        executor.setOutput(UNIT - 1);
        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.InsufficientBoughtMuppets.selector, UNIT - 1, UNIT));
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        _assertUntouched();
        assertEq(executor.nativeSpent(), 0);
        assertEq(executor.recipient(), address(0));
    }

    function testUnavailableBoundKeyRollsBackSwapAndClaim() public {
        vm.startPrank(DEV);
        muppets.approve(address(bond), 3 * UNIT);
        bond.bond(address(key), 3);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.MissingBoundKeys.selector, 0, 1));
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        assertEq(bond.pendingTotalReward(DEV), 3 ether);
        assertEq(bond.totalRewardsClaimed(), 0);
        assertEq(executor.nativeSpent(), 0);
        assertEq(bond.accountPositionCount(DEV), 2);
        assertEq(muppets.balanceOf(address(bond)), 4 * UNIT);
    }

    function testWrongOwnerCannotReinvest() public {
        vm.prank(makeAddr("not-dev"));
        vm.expectRevert(MuppetAgentBond.NotPositionOwner.selector);
        bond.claimBuyAndBond(
            originalPosition,
            1 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            UNIT,
            block.timestamp + 1 minutes
        );
        _assertUntouched();
    }

    function testCannotClaimTwiceAfterReinvestment() public {
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        vm.expectRevert(MuppetAgentBond.InvalidAmount.selector);
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        vm.prank(DEV);
        vm.expectRevert(MuppetAgentBond.InvalidAmount.selector);
        bond.claimPositionRewards(originalPosition);
    }

    function testPausedBlocksReinvestmentButAllowsClaimAndMaturedWithdrawal() public {
        governance.execute(address(bond), abi.encodeCall(MuppetAgentBond.pause, ()));
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        vm.prank(DEV);
        bond.claimPositionRewards(originalPosition);
        assertEq(weth.balanceOf(DEV), 3 ether);
        vm.warp(bond.getPosition(originalPosition).unlockAt);
        vm.prank(DEV);
        bond.unbondPosition(originalPosition);
        assertEq(muppets.balanceOf(DEV), 60_000 ether);
    }

    function testExecutorCannotReenterAnyClaim() public {
        executor.setCallback(address(bond), abi.encodeCall(MuppetAgentBond.claimPositionRewards, (originalPosition)));
        _reinvest(1 ether, UNIT, block.timestamp + 1 minutes);
        assertFalse(executor.callbackSucceeded());
        assertEq(executor.callbackError(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(bond.totalRewardsClaimed(), 3 ether);
    }

    function testUnregisteredKeyRejectedWithoutConsumingRewards() public {
        vm.prank(DEV);
        vm.expectRevert(MuppetAgentBond.InvalidAgentKey.selector);
        bond.claimBuyAndBond(
            originalPosition,
            1 ether,
            address(weth),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            UNIT,
            block.timestamp + 1 minutes
        );
        _assertUntouched();
    }

    function testConstructorRejectsWrongMuppetsExecutor() public {
        MockERC20 other = new MockERC20("Other", "OTHER", 18, 0);
        ReinvestmentBuyExecutor wrong = new ReinvestmentBuyExecutor(other);
        vm.expectRevert(MuppetAgentBond.InvalidBuyExecutor.selector);
        new MuppetAgentBond(address(this), muppets, weth, UNIT, 30 days, IMuppetRewardBuyExecutor(address(wrong)));
    }

    function testUnexpectedNativeTransferRejected() public {
        (bool ok,) = address(bond).call{value: 1 wei}("");
        assertFalse(ok);
    }

    function _reinvest(uint256 spend, uint256 minimum, uint256 deadline) internal {
        vm.prank(DEV);
        bond.claimBuyAndBond(
            originalPosition, spend, address(key), 1, MuppetAgentBond.BondTerm.THIRTY_DAYS, minimum, deadline
        );
    }

    function _assertUntouched() internal view {
        assertEq(bond.pendingTotalReward(DEV), 3 ether);
        assertEq(bond.totalRewardsClaimed(), 0);
        assertEq(bond.rewardLiability(), 3 ether);
        assertEq(bond.keyRewardLiability(address(key)), 1 ether);
        assertEq(bond.accountPositionCount(DEV), 1);
        assertEq(bond.bondedBalance(DEV), UNIT);
        assertEq(muppets.balanceOf(address(bond)), UNIT);
        assertEq(executor.nativeSpent(), 0);
    }
}
