// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {IKeyRevenueReceiver, KeyMarketplaceV2} from "../src/KeyMarketplaceV2.sol";
import {IMuppetRewardBuyExecutor, MuppetAgentBond} from "../src/MuppetAgentBond.sol";
import {
    IMuppetAgentBondRewards,
    IMuppetBuybackVaultFunding,
    IWrappedRevenueToken,
    MuppetRevenueRouter
} from "../src/MuppetRevenueRouter.sol";

contract MockWrappedRevenueToken is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "unwrap failed");
    }
}

contract MockRevenueRewardBuyExecutor {
    IERC20 public immutable MUPPETS;

    constructor(IERC20 muppets) {
        MUPPETS = muppets;
    }

    function executeBuy(uint256, uint256, address) external payable returns (uint256) {
        revert("unused in revenue routing tests");
    }
}

contract MockPonsFeeEscrow {
    mapping(address recipient => uint256 amount) public credit;

    function addCredit(address recipient) external payable {
        credit[recipient] += msg.value;
    }

    function claim() external {
        uint256 amount = credit[msg.sender];
        credit[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "claim failed");
    }
}

contract RevenueGovernanceHarness {
    receive() external payable {}

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool ok, bytes memory response) = target.call(data);
        require(ok, "governance call failed");
        return response;
    }
}

contract MockBuybackVault {
    address public revenueRouter;
    mapping(address key => uint256 amount) public fundedByKey;

    function setRevenueRouter(address router) external {
        revenueRouter = router;
    }

    function fundKey(address key) external payable {
        require(msg.sender == revenueRouter, "router only");
        fundedByKey[key] += msg.value;
    }
}

contract MuppetRevenueTest is Test {
    MockERC20 internal muppets;
    MockWrappedRevenueToken internal weth;
    MockPonsFeeEscrow internal feeEscrow;
    RevenueGovernanceHarness internal governance;
    RevenueGovernanceHarness internal reserve;
    RevenueGovernanceHarness internal operations;
    KeyMarketplace internal market;
    KeyMarketplaceV2 internal marketV2;
    MuppetAgentBond internal bond;
    MuppetRevenueRouter internal router;
    MockBuybackVault internal buybackVault;
    AgentKey internal key;

    address internal holder = makeAddr("holder");
    address internal buyer = makeAddr("buyer");

    function setUp() public {
        vm.warp(200 * 7 days + 1 days);
        muppets = new MockERC20("Muppets", "MUPPETS", 18, 0);
        weth = new MockWrappedRevenueToken();
        feeEscrow = new MockPonsFeeEscrow();
        governance = new RevenueGovernanceHarness();
        reserve = new RevenueGovernanceHarness();
        operations = new RevenueGovernanceHarness();
        market = new KeyMarketplace(address(this), payable(address(reserve)), 300);
        market.setFactory(address(this));
        key = new AgentKey("Frog Key", "FROG", holder, 100);
        market.registerKey(IERC20(address(key)));

        bond = new MuppetAgentBond(
            address(this),
            muppets,
            weth,
            15_000 ether,
            30 days,
            IMuppetRewardBuyExecutor(address(new MockRevenueRewardBuyExecutor(muppets)))
        );
        buybackVault = new MockBuybackVault();
        router = new MuppetRevenueRouter(
            address(this),
            address(feeEscrow),
            IWrappedRevenueToken(address(weth)),
            IMuppetAgentBondRewards(address(bond)),
            IMuppetBuybackVaultFunding(address(buybackVault)),
            payable(address(reserve)),
            payable(address(operations))
        );
        buybackVault.setRevenueRouter(address(router));
        marketV2 = new KeyMarketplaceV2(address(this), IKeyRevenueReceiver(address(router)), 300);
        marketV2.setFactory(address(this));
        marketV2.registerKey(IERC20(address(key)));
        bond.setKeyRegistry(address(market), true);
        bond.setKeyRegistry(address(marketV2), true);
        bond.setRewardNotifier(address(router));
        router.setMarketplace(address(market), true);
        router.setKeyMarketplace(address(marketV2), true);
        market.setTreasury(payable(address(router)));
        bond.transferOwnership(address(governance));
        router.transferOwnership(address(governance));
        governance.execute(address(bond), abi.encodeCall(MuppetAgentBond.activate, ()));
        governance.execute(address(router), abi.encodeCall(MuppetRevenueRouter.activate, ()));

        muppets.mint(holder, 60_000 ether);
        vm.deal(address(this), 10 ether);
        vm.deal(buyer, 10 ether);
    }

    function testOneBoundKeyAndFifteenThousandMuppetsCreateOneRewardUnit() public {
        _bindAndBond(1);

        assertEq(bond.rewardUnits(holder), 1);
        assertEq(bond.bondedBalance(holder), 15_000 ether);
        assertEq(bond.unitsByKey(holder, address(key)), 1);
        assertEq(key.boundBalance(holder), 1);
        assertEq(key.balanceOf(holder), 99);
        assertEq(muppets.balanceOf(holder), 45_000 ether);

        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.MissingBoundKeys.selector, 0, 1));
        vm.prank(holder);
        bond.bond(address(key), 1);
    }

    function testPonsRevenueRoutesFiftyThirtyTwentyAndPaysWeth() public {
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        feeEscrow.addCredit{value: 2.35 ether}(address(router));

        assertEq(router.claimPonsFees(), 2.35 ether);
        uint256 reserveBefore = address(reserve).balance;
        uint256 operationsBefore = address(operations).balance;
        _finishReceiptWeek();
        router.routeRevenue();

        assertEq(router.totalPonsRevenue(), 2.35 ether);
        assertEq(router.totalRevenueRouted(), 2.35 ether);
        assertEq(router.totalBondRewardsAllocated(), 1.175 ether);
        assertEq(router.totalStockReserveRouted(), 0.705 ether);
        assertEq(router.totalOperationsRouted(), 0.47 ether);
        assertEq(address(reserve).balance - reserveBefore, 0.705 ether);
        assertEq(address(operations).balance - operationsBefore, 0.47 ether);
        assertEq(bond.pendingReward(holder), 1.175 ether);

        vm.prank(holder);
        (uint256 globalWeth, uint256 keyWeth) = bond.claimPositionRewards(positionId);
        assertEq(globalWeth, 1.175 ether);
        assertEq(keyWeth, 0);
        assertEq(weth.balanceOf(holder), 1.175 ether);
        assertEq(bond.totalRewardsClaimed(), 1.175 ether);
    }

    function testEmptyReceiptWeekNeverPaysFutureBondHolders() public {
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        uint40 receiptEpoch = router.currentRevenueEpoch();
        _finishReceiptWeek();
        router.routeRevenue();
        assertEq(router.pendingBondRewardsNative(), 0.5 ether);
        assertEq(router.totalBondRewardsDelivered(), 0);

        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        vm.expectRevert(MuppetRevenueRouter.UnallocatedRewardsLockedToEpoch.selector);
        router.releasePendingBondRewards();
        assertEq(router.pendingBondRewardsNative(), 0.5 ether);
        assertEq(router.totalUnallocatedBondRewardsNative(), 0.5 ether);
        assertEq(router.globalRevenueEpoch(receiptEpoch).unallocatedBondRewards, 0.5 ether);
        assertEq(bond.totalRewardWeightAtEpoch(receiptEpoch), 0);
        assertEq(bond.pendingReward(holder), 0);
    }

    function testMarketplaceFeesAreRecordedAsRevenue() public {
        vm.startPrank(holder);
        key.approve(address(market), 1);
        market.createListing(IERC20(address(key)), 1, 1 ether);
        vm.stopPrank();

        vm.prank(buyer);
        market.buy{value: 1.03 ether}(1, 1);

        assertEq(router.totalMarketplaceRevenue(), 0.03 ether);
        assertEq(router.totalLegacyMarketplaceRevenue(), 0.03 ether);
        assertEq(router.unroutedRevenue(), 0.03 ether);
        assertEq(router.totalFundingReceived(), 0);
    }

    function testV2MarketplaceRoutesExactKeyRevenueFiftyTwentyFiveFifteenTen() public {
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        vm.startPrank(holder);
        key.approve(address(marketV2), 1);
        marketV2.createListing(IERC20(address(key)), 1, 2 ether);
        vm.stopPrank();

        uint256 reserveBefore = address(reserve).balance;
        uint256 operationsBefore = address(operations).balance;
        vm.prank(buyer);
        marketV2.buy{value: 2.06 ether}(1, 1);

        MuppetRevenueRouter.KeyRevenueAccount memory beforeRoute = router.keyRevenueState(address(key));
        assertEq(beforeRoute.totalVolume, 2 ether);
        assertEq(beforeRoute.totalRevenue, 0.06 ether);
        assertEq(router.unroutedRevenue(), 0);
        assertEq(router.keyUnroutedRevenue(address(key)), 0.06 ether);

        _finishReceiptWeek();
        router.routeKeyRevenue(address(key));
        MuppetRevenueRouter.KeyRevenueAccount memory afterRoute = router.keyRevenueState(address(key));
        assertEq(afterRoute.totalBondRewardsAllocated, 0.03 ether);
        assertEq(afterRoute.totalBuybackRouted, 0.015 ether);
        assertEq(afterRoute.totalStockReserveRouted, 0.009 ether);
        assertEq(afterRoute.totalOperationsRouted, 0.006 ether);
        assertEq(buybackVault.fundedByKey(address(key)), 0.015 ether);
        assertEq(address(reserve).balance - reserveBefore, 0.009 ether);
        assertEq(address(operations).balance - operationsBefore, 0.006 ether);
        assertEq(bond.pendingKeyReward(holder, address(key)), 0.03 ether);
        assertEq(bond.pendingReward(holder), 0);

        vm.prank(holder);
        (uint256 globalWeth, uint256 keyWeth) = bond.claimPositionRewards(positionId);
        assertEq(globalWeth, 0);
        assertEq(keyWeth, 0.03 ether);
        assertEq(weth.balanceOf(holder), 0.03 ether);
    }

    function testKeyRevenueDoesNotLeakToAnotherKeyBond() public {
        address secondHolder = makeAddr("second-holder");
        AgentKey secondKey = new AgentKey("Fox Key", "FOX", secondHolder, 100);
        marketV2.registerKey(IERC20(address(secondKey)));
        muppets.mint(secondHolder, 15_000 ether);

        uint256 firstPositionId = _bindAndBond(1);
        vm.startPrank(secondHolder);
        secondKey.bind(1);
        muppets.approve(address(bond), 15_000 ether);
        uint256 secondPositionId = bond.bond(address(secondKey), 1);
        vm.stopPrank();
        _completeFirstEligibleEpoch(firstPositionId);
        assertEq(bond.latestCompletedEpoch(), bond.getPosition(secondPositionId).firstEligibleEpoch);

        vm.startPrank(holder);
        key.approve(address(marketV2), 1);
        marketV2.createListing(IERC20(address(key)), 1, 1 ether);
        vm.stopPrank();
        vm.prank(buyer);
        marketV2.buy{value: 1.03 ether}(1, 1);
        _finishReceiptWeek();
        router.routeKeyRevenue(address(key));

        assertEq(bond.pendingKeyReward(holder, address(key)), 0.015 ether);
        assertEq(bond.pendingKeyReward(secondHolder, address(secondKey)), 0);
        assertEq(bond.pendingReward(secondHolder), 0);
    }

    function testRevenueAccumulatesBetweenWeeklyRoutes() public {
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();

        feeEscrow.addCredit{value: 0.5 ether}(address(router));
        router.claimPonsFees();
        uint40 receiptEpoch = router.currentRevenueEpoch();
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.EpochNotComplete.selector, receiptEpoch));
        router.routeRevenue();
        assertEq(router.unroutedRevenue(), 0.5 ether);

        _finishReceiptWeek();
        router.routeRevenue();
        assertEq(router.unroutedRevenue(), 0);
        assertEq(router.totalRevenueRouted(), 1.5 ether);
    }

    function testFundingNeverBecomesReportedRevenue() public {
        router.fund{value: 1 ether}();
        assertEq(router.totalFundingReceived(), 1 ether);
        assertEq(router.withdrawableFunding(), 1 ether);
        assertEq(router.unroutedRevenue(), 0);

        vm.expectRevert(MuppetRevenueRouter.NoRevenue.selector);
        router.routeRevenue();

        governance.execute(address(router), abi.encodeCall(MuppetRevenueRouter.pause, ()));
        uint256 beforeBalance = address(governance).balance;
        governance.execute(
            address(router),
            abi.encodeCall(MuppetRevenueRouter.withdrawFunding, (payable(address(governance)), 1 ether))
        );
        assertEq(address(governance).balance - beforeBalance, 1 ether);
    }

    function testMuppetsUnlockButTheAgentKeyStaysPermanentlyBound() public {
        uint256 positionId = _bindAndBond(1);
        uint256 unlockTimestamp = bond.getPosition(positionId).unlockAt;

        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.LockActive.selector, unlockTimestamp));
        vm.prank(holder);
        bond.unbondPosition(positionId);

        vm.warp(unlockTimestamp);
        vm.prank(holder);
        bond.unbondPosition(positionId);

        assertEq(muppets.balanceOf(holder), 60_000 ether);
        assertEq(bond.rewardUnits(holder), 0);
        assertEq(key.boundBalance(holder), 1);
        assertEq(key.balanceOf(holder), 99);
    }

    function testBondMaturesBeforeItsFirstFullRewardEpoch() public {
        uint256 positionId = _bindAndBond(1);
        MuppetAgentBond.BondPosition memory position = bond.getPosition(positionId);

        assertEq(position.maturesAt, position.bondedAt + 7 days);
        assertEq(position.unlockAt, position.bondedAt + 30 days);
        assertEq(position.multiplierBps, 10_000);
        assertEq(bond.totalRewardWeightAtEpoch(position.firstEligibleEpoch - 1), 0);
        assertEq(bond.totalRewardWeightAtEpoch(position.firstEligibleEpoch), 10_000);

        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();
        assertEq(bond.pendingReward(holder), 0);
        assertEq(router.pendingBondRewardsNative(), 0.5 ether);
    }

    function testLongerTermsReceiveMoreWeightWithoutChangingTheRewardPot() public {
        vm.startPrank(holder);
        key.bind(2);
        muppets.approve(address(bond), 30_000 ether);
        uint256 thirtyDayPosition = bond.bondWithTerm(address(key), 1, MuppetAgentBond.BondTerm.THIRTY_DAYS);
        uint256 oneEightyDayPosition = bond.bondWithTerm(address(key), 1, MuppetAgentBond.BondTerm.ONE_EIGHTY_DAYS);
        vm.stopPrank();
        _completeFirstEligibleEpoch(thirtyDayPosition);

        vm.startPrank(holder);
        key.approve(address(marketV2), 1);
        marketV2.createListing(IERC20(address(key)), 1, 2 ether);
        vm.stopPrank();
        vm.prank(buyer);
        marketV2.buy{value: 2.06 ether}(1, 1);
        _finishReceiptWeek();
        router.routeKeyRevenue(address(key));

        (, uint256 thirtyDayKeyWeth) = bond.pendingPositionRewards(thirtyDayPosition);
        (, uint256 oneEightyDayKeyWeth) = bond.pendingPositionRewards(oneEightyDayPosition);
        assertEq(thirtyDayKeyWeth, 0.012 ether);
        assertEq(oneEightyDayKeyWeth, 0.018 ether);
        assertEq(thirtyDayKeyWeth + oneEightyDayKeyWeth, 0.03 ether);
    }

    function testEveryFixedTermHasThePublishedDurationAndWeight() public view {
        (uint40 thirtyDays, uint16 oneX) = bond.termConfig(MuppetAgentBond.BondTerm.THIRTY_DAYS);
        (uint40 ninetyDays, uint16 onePointTwoFiveX) = bond.termConfig(MuppetAgentBond.BondTerm.NINETY_DAYS);
        (uint40 oneEightyDays, uint16 onePointFiveX) = bond.termConfig(MuppetAgentBond.BondTerm.ONE_EIGHTY_DAYS);

        assertEq(thirtyDays, 30 days);
        assertEq(oneX, 10_000);
        assertEq(ninetyDays, 90 days);
        assertEq(onePointTwoFiveX, 12_500);
        assertEq(oneEightyDays, 180 days);
        assertEq(onePointFiveX, 15_000);
    }

    function testLateBondCannotShareAnEarlierCompletedEpoch() public {
        uint256 maturePosition = _bindAndBond(1);
        _completeFirstEligibleEpoch(maturePosition);

        vm.startPrank(holder);
        key.bind(1);
        muppets.approve(address(bond), 15_000 ether);
        uint256 latePosition = bond.bond(address(key), 1);
        vm.stopPrank();

        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();

        (uint256 matureGlobal,) = bond.pendingPositionRewards(maturePosition);
        (uint256 lateGlobal,) = bond.pendingPositionRewards(latePosition);
        assertEq(matureGlobal, 0.5 ether);
        assertEq(lateGlobal, 0);
    }

    function testOnlyPositionOwnerCanClaimOrWithdraw() public {
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();

        vm.expectRevert(MuppetAgentBond.NotPositionOwner.selector);
        vm.prank(buyer);
        bond.claimPositionRewards(positionId);

        vm.warp(bond.getPosition(positionId).unlockAt);
        vm.expectRevert(MuppetAgentBond.NotPositionOwner.selector);
        vm.prank(buyer);
        bond.unbondPosition(positionId);
    }

    function testCompletedEpochGuardAndNoDoubleClaim() public {
        uint256 positionId = _bindAndBond(1);
        uint40 currentEpoch = bond.currentEpoch();

        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.EpochNotComplete.selector, currentEpoch));
        vm.prank(address(router));
        bond.notifyReward(currentEpoch, 1 ether);

        _completeFirstEligibleEpoch(positionId);
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();

        vm.prank(holder);
        bond.claimPositionRewards(positionId);
        assertEq(bond.pendingTotalReward(holder), 0);
        assertEq(bond.rewardLiability(), 0);

        vm.expectRevert(MuppetAgentBond.InvalidAmount.selector);
        vm.prank(holder);
        bond.claimPositionRewards(positionId);
    }

    function testHistoricalRewardsRemainClaimableAfterPositionUnlock() public {
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();

        vm.warp(bond.getPosition(positionId).unlockAt);
        vm.prank(holder);
        bond.unbondPosition(positionId);
        assertEq(bond.pendingTotalReward(holder), 0.5 ether);

        vm.prank(holder);
        bond.claimPositionRewards(positionId);
        assertEq(weth.balanceOf(holder), 0.5 ether);
        assertEq(muppets.balanceOf(holder), 60_000 ether);
    }

    function testDelayedGlobalRoutePaysOriginalReceiptWeekNotNewcomer() public {
        uint256 original = _bindAndBond(1);
        _completeFirstEligibleEpoch(original);
        uint40 receiptEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        uint256 newcomer = _bindAndBond(1);
        _completeFirstEligibleEpoch(newcomer);
        assertGt(bond.latestCompletedEpoch(), receiptEpoch);
        assertGt(block.timestamp, bond.getPosition(original).unlockAt);
        vm.prank(holder);
        bond.unbondPosition(original);

        router.routeRevenue();
        (uint256 originalReward,) = bond.pendingPositionRewards(original);
        (uint256 newcomerReward,) = bond.pendingPositionRewards(newcomer);
        assertEq(originalReward, 0.5 ether);
        assertEq(newcomerReward, 0);
        assertEq(bond.totalRewardWeightAtEpoch(receiptEpoch), 10_000);
        MuppetRevenueRouter.RevenueEpochAccount memory receipt = router.globalRevenueEpoch(receiptEpoch);
        assertEq(receipt.eligibleWeight, 10_000);
        assertEq(receipt.bondRewardsDelivered, 0.5 ether);
        assertEq(receipt.finalizedAt, block.timestamp);
        vm.prank(holder);
        bond.claimPositionRewards(original);
        assertEq(weth.balanceOf(holder), 0.5 ether);
        assertEq(bond.accountRewardsClaimed(holder), 0.5 ether);
        assertEq(bond.accountRewardsReinvested(holder), 0);
    }

    function testDelayedKeyRouteKeepsOriginalKeyAndReceiptWeek() public {
        uint256 original = _bindAndBond(1);
        _completeFirstEligibleEpoch(original);
        uint40 receiptEpoch = router.currentRevenueEpoch();
        _recordKeyFee(address(key), 1 ether, 10 ether);
        _finishReceiptWeek();
        uint256 newcomer = _bindAndBond(1);
        _completeFirstEligibleEpoch(newcomer);
        router.routeKeyRevenue(address(key));
        (, uint256 originalReward) = bond.pendingPositionRewards(original);
        (, uint256 newcomerReward) = bond.pendingPositionRewards(newcomer);
        assertEq(originalReward, 0.5 ether);
        assertEq(newcomerReward, 0);
        assertEq(bond.pendingReward(holder), 0);
        assertEq(router.keyRevenueEpoch(address(key), receiptEpoch).bondRewardsDelivered, 0.5 ether);
        assertEq(router.keyRevenueEpoch(address(key), receiptEpoch).eligibleWeight, 10_000);
    }

    function testReceiptWeekSourcesAccumulateAndFundingStaysSeparate() public {
        uint40 epoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 0.7 ether}(address(router));
        router.claimPonsFees();
        vm.deal(address(market), 0.3 ether);
        vm.prank(address(market));
        (bool sent,) = address(router).call{value: 0.3 ether}("");
        assertTrue(sent);
        router.fund{value: 0.25 ether}();
        (sent,) = address(router).call{value: 0.25 ether}("");
        assertTrue(sent);

        MuppetRevenueRouter.RevenueEpochAccount memory receipt = router.globalRevenueEpoch(epoch);
        assertEq(receipt.revenue, 1 ether);
        assertEq(receipt.ponsRevenue, 0.7 ether);
        assertEq(receipt.legacyMarketplaceRevenue, 0.3 ether);
        assertEq(receipt.volume, 0);
        assertEq(receipt.finalizedAt, 0);
        assertEq(router.globalRevenueEpochCount(), 1);
        assertEq(router.globalRevenueEpochAt(0), epoch);
        assertEq(router.totalFundingReceived(), 0.5 ether);
        assertEq(router.withdrawableFunding(), 0.5 ether);
        assertEq(router.unroutedRevenue(), 1 ether);
    }

    function testPonsEpochIsReceiptWeekNotExternalEscrowAccrualWeek() public {
        uint40 accrualEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 ether}(address(router));
        vm.warp(block.timestamp + 3 * 7 days);
        uint40 receiptEpoch = router.currentRevenueEpoch();
        router.claimPonsFees();
        assertEq(router.globalRevenueEpoch(accrualEpoch).revenue, 0);
        assertEq(router.globalRevenueEpoch(receiptEpoch).ponsRevenue, 1 ether);
        assertEq(router.globalRevenueEpochCount(), 1);
    }

    function testEmptyKeyWeekStaysUnallocatedEvenAfterNewBondExists() public {
        uint40 emptyEpoch = router.currentRevenueEpoch();
        _recordKeyFee(address(key), 1 ether, 10 ether);
        _finishReceiptWeek();
        router.routeKeyRevenue(address(key));
        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        assertEq(bond.totalKeyRewardWeightAtEpoch(address(key), emptyEpoch), 0);
        vm.expectRevert(MuppetRevenueRouter.UnallocatedRewardsLockedToEpoch.selector);
        router.releasePendingKeyBondRewards(address(key));

        uint40 productiveEpoch = router.currentRevenueEpoch();
        _recordKeyFee(address(key), 0.4 ether, 4 ether);
        _finishReceiptWeek();
        router.routeKeyRevenue(address(key));
        assertEq(bond.pendingKeyReward(holder, address(key)), 0.2 ether);
        assertEq(router.keyUnallocatedBondRewardsNative(address(key)), 0.5 ether);
        assertEq(router.totalUnallocatedBondRewardsNative(), 0.5 ether);
        assertEq(router.keyRevenueEpoch(address(key), emptyEpoch).unallocatedBondRewards, 0.5 ether);
        assertEq(router.keyRevenueEpoch(address(key), productiveEpoch).bondRewardsDelivered, 0.2 ether);
        assertEq(address(router).balance, 0.5 ether);
    }

    function testUnallocatedGlobalSharesCannotBeWithdrawnAsFunding() public {
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        router.routeRevenue();
        assertEq(router.withdrawableFunding(), 0);
        governance.execute(address(router), abi.encodeCall(MuppetRevenueRouter.pause, ()));
        vm.prank(address(governance));
        vm.expectRevert(MuppetRevenueRouter.InvalidAmount.selector);
        router.withdrawFunding(payable(address(governance)), 0.5 ether);
        assertEq(address(router).balance, 0.5 ether);
    }

    function testCurrentWeekCannotRouteThroughSingleOrBatchMethods() public {
        uint40 epoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _recordKeyFee(address(key), 1 ether, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.EpochNotComplete.selector, epoch));
        router.routeRevenue();
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.EpochNotComplete.selector, epoch));
        router.routeRevenueEpochs(20);
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.EpochNotComplete.selector, epoch));
        router.routeKeyRevenue(address(key));
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.EpochNotComplete.selector, epoch));
        router.routeKeyRevenueEpochs(address(key), 20);
        assertEq(router.globalEpochCursor(), 0);
        assertEq(router.keyEpochCursor(address(key)), 0);
    }

    function testClosedWeekCannotRouteTwice() public {
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _recordKeyFee(address(key), 1 ether, 10 ether);
        _finishReceiptWeek();
        router.routeRevenue();
        router.routeKeyRevenue(address(key));
        uint256 routed = router.totalRevenueRouted();
        vm.expectRevert(MuppetRevenueRouter.NoRevenue.selector);
        router.routeRevenue();
        vm.expectRevert(MuppetRevenueRouter.NoRevenue.selector);
        router.routeKeyRevenue(address(key));
        assertEq(router.totalRevenueRouted(), routed);
        assertEq(router.globalEpochCursor(), 1);
        assertEq(router.keyEpochCursor(address(key)), 1);
    }

    function testBatchUsesOnlyNonemptyWeeksAcrossLongGaps() public {
        uint40 firstEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        vm.warp(block.timestamp + 1000 * 7 days);
        uint40 secondEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 2 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        (uint256 count, uint256 amount) = router.routeRevenueEpochs(20);
        assertEq(count, 2);
        assertEq(amount, 3 ether);
        assertEq(router.globalEpochCursor(), 2);
        assertEq(router.globalRevenueEpochCount(), 2);
        assertEq(router.globalRevenueEpochAt(0), firstEpoch);
        assertEq(router.globalRevenueEpochAt(1), secondEpoch);
        assertEq(router.totalUnallocatedBondRewardsNative(), 1.5 ether);
    }

    function testBoundedBatchesAdvanceCursorWithoutSkippingCurrentWeek() public {
        for (uint256 i; i < 3; ++i) {
            feeEscrow.addCredit{value: 1 ether}(address(router));
            router.claimPonsFees();
            _finishReceiptWeek();
        }
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        (uint256 count, uint256 amount) = router.routeRevenueEpochs(2);
        assertEq(count, 2);
        assertEq(amount, 2 ether);
        assertEq(router.globalEpochCursor(), 2);
        (count, amount) = router.routeRevenueEpochs(20);
        assertEq(count, 1);
        assertEq(amount, 1 ether);
        assertEq(router.globalEpochCursor(), 3);
        assertEq(router.globalRevenueEpochCount(), 4);
        assertEq(router.unroutedRevenue(), 1 ether);
        vm.expectRevert(MuppetRevenueRouter.InvalidBatchSize.selector);
        router.routeRevenueEpochs(0);
        vm.expectRevert(MuppetRevenueRouter.InvalidBatchSize.selector);
        router.routeRevenueEpochs(21);
    }

    function testSecondBatchPaymentRevertRollsBackEveryWeekAndCursor() public {
        uint40 firstEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        uint40 secondEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 2 ether}(address(router));
        router.claimPonsFees();
        _finishReceiptWeek();
        vm.mockCallRevert(address(reserve), 0.6 ether, bytes(""), abi.encodeWithSignature("Error(string)", "reject"));
        vm.expectRevert(MuppetRevenueRouter.PaymentFailed.selector);
        router.routeRevenueEpochs(2);
        assertEq(router.globalEpochCursor(), 0);
        assertEq(router.totalRevenueRouted(), 0);
        assertEq(router.totalUnallocatedBondRewardsNative(), 0);
        assertEq(router.globalRevenueEpoch(firstEpoch).finalizedAt, 0);
        assertEq(router.globalRevenueEpoch(secondEpoch).finalizedAt, 0);
        assertEq(address(router).balance, 3 ether);
        assertEq(address(reserve).balance, 0);
        assertEq(address(operations).balance, 0);

        vm.clearMockedCalls();
        (uint256 count, uint256 amount) = router.routeRevenueEpochs(2);
        assertEq(count, 2);
        assertEq(amount, 3 ether);
        assertEq(router.globalEpochCursor(), 2);
        assertEq(router.totalUnallocatedBondRewardsNative(), 1.5 ether);
        assertEq(address(reserve).balance, 0.9 ether);
        assertEq(address(operations).balance, 0.6 ether);
    }

    function testKeyBatchKeepsKeysSeparateAndValidatesBounds() public {
        address secondKey = address(new AgentKey("Other Key", "OTHER", holder, 100));
        _recordKeyFee(address(key), 1 ether, 10 ether);
        _recordKeyFee(secondKey, 2 ether, 20 ether);
        _finishReceiptWeek();
        _recordKeyFee(address(key), 0.5 ether, 5 ether);
        _finishReceiptWeek();
        (uint256 count, uint256 amount) = router.routeKeyRevenueEpochs(address(key), 1);
        assertEq(count, 1);
        assertEq(amount, 1 ether);
        assertEq(router.keyEpochCursor(secondKey), 0);
        assertEq(router.keyUnroutedRevenue(secondKey), 2 ether);
        (count, amount) = router.routeKeyRevenueEpochs(address(key), 20);
        assertEq(count, 1);
        assertEq(amount, 0.5 ether);
        assertEq(router.keyEpochCursor(address(key)), 2);
        assertEq(router.keyRevenueEpochCount(address(key)), 2);
        assertEq(router.keyRevenueEpochCount(secondKey), 1);
        vm.expectRevert(MuppetRevenueRouter.InvalidBatchSize.selector);
        router.routeKeyRevenueEpochs(address(key), 0);
        vm.expectRevert(MuppetRevenueRouter.InvalidBatchSize.selector);
        router.routeKeyRevenueEpochs(address(key), 21);
    }

    function testRoundingIsPerReceiptWeekAndConservesEveryWei() public {
        uint40 firstEpoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: 1 wei}(address(router));
        router.claimPonsFees();
        feeEscrow.addCredit{value: 1 wei}(address(router));
        router.claimPonsFees();
        _recordKeyFee(address(key), 3 wei, 100 wei);
        _recordKeyFee(address(key), 4 wei, 100 wei);
        _finishReceiptWeek();
        router.routeRevenue();
        router.routeKeyRevenue(address(key));
        MuppetRevenueRouter.RevenueEpochAccount memory global = router.globalRevenueEpoch(firstEpoch);
        MuppetRevenueRouter.RevenueEpochAccount memory exactKey = router.keyRevenueEpoch(address(key), firstEpoch);
        assertEq(global.bondRewards, 1);
        assertEq(global.operations, 1);
        assertEq(global.stockReserve, 0);
        assertEq(global.revenue, global.bondRewards + global.stockReserve + global.operations);
        assertEq(exactKey.bondRewards, 3);
        assertEq(exactKey.buyback, 1);
        assertEq(exactKey.stockReserve, 1);
        assertEq(exactKey.operations, 2);
        assertEq(
            exactKey.revenue, exactKey.bondRewards + exactKey.buyback + exactKey.stockReserve + exactKey.operations
        );
        assertEq(address(router).balance, 4);
    }

    function testZeroFeeReceiveDoesNotAppendAnEmptyWeek() public {
        vm.prank(address(market));
        (bool sent,) = address(router).call("");
        assertTrue(sent);
        assertEq(router.globalRevenueEpochCount(), 0);
        assertEq(router.unroutedRevenue(), 0);
    }

    function testFuzzWeeklySplitsConserveNativeRevenue(uint96 globalInput, uint96 keyInput) public {
        uint256 globalAmount = bound(uint256(globalInput), 1, 2 ether);
        uint256 keyAmount = bound(uint256(keyInput), 1, 2 ether);
        uint40 epoch = router.currentRevenueEpoch();
        feeEscrow.addCredit{value: globalAmount}(address(router));
        router.claimPonsFees();
        _recordKeyFee(address(key), keyAmount, keyAmount * 10);
        _finishReceiptWeek();
        router.routeRevenueEpochs(20);
        router.routeKeyRevenueEpochs(address(key), 20);
        MuppetRevenueRouter.RevenueEpochAccount memory global = router.globalRevenueEpoch(epoch);
        MuppetRevenueRouter.RevenueEpochAccount memory exactKey = router.keyRevenueEpoch(address(key), epoch);
        assertEq(globalAmount, global.bondRewards + global.stockReserve + global.operations);
        assertEq(keyAmount, exactKey.bondRewards + exactKey.buyback + exactKey.stockReserve + exactKey.operations);
        assertEq(router.totalRevenueRouted(), globalAmount + keyAmount);
        assertEq(router.totalBondRewardsAllocated(), global.bondRewards + exactKey.bondRewards);
        assertEq(router.totalBondRewardsDelivered(), 0);
        assertEq(router.totalUnallocatedBondRewardsNative(), global.bondRewards + exactKey.bondRewards);
        assertEq(address(router).balance, router.totalUnallocatedBondRewardsNative());
        assertEq(address(reserve).balance, global.stockReserve + exactKey.stockReserve);
        assertEq(address(operations).balance, global.operations + exactKey.operations);
        assertEq(buybackVault.fundedByKey(address(key)), exactKey.buyback);
    }

    function _recordKeyFee(address targetKey, uint256 fee, uint256 volume) private {
        vm.deal(address(marketV2), fee);
        vm.prank(address(marketV2));
        router.recordKeyMarketplaceRevenue{value: fee}(targetKey, volume);
    }

    function _bindAndBond(uint256 units) private returns (uint256 positionId) {
        vm.startPrank(holder);
        key.bind(units);
        muppets.approve(address(bond), units * 15_000 ether);
        positionId = bond.bond(address(key), units);
        vm.stopPrank();
    }

    function _completeFirstEligibleEpoch(uint256 positionId) private {
        MuppetAgentBond.BondPosition memory position = bond.getPosition(positionId);
        vm.warp(bond.epochStart(position.firstEligibleEpoch + 1));
    }

    function _finishReceiptWeek() private {
        vm.warp((uint256(router.currentRevenueEpoch()) + 1) * 7 days);
    }
}
