// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {IKeyRevenueReceiver, KeyMarketplaceV2} from "../src/KeyMarketplaceV2.sol";
import {MuppetAgentBond} from "../src/MuppetAgentBond.sol";
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

        bond = new MuppetAgentBond(address(this), muppets, weth, 15_000 ether, 30 days);
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

    function testRewardsQueueUntilARealUnitExists() public {
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        router.routeRevenue();
        assertEq(router.pendingBondRewardsNative(), 0.5 ether);
        assertEq(router.totalBondRewardsDelivered(), 0);

        uint256 positionId = _bindAndBond(1);
        _completeFirstEligibleEpoch(positionId);
        router.releasePendingBondRewards();
        assertEq(router.pendingBondRewardsNative(), 0);
        assertEq(bond.pendingReward(holder), 0.5 ether);
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
        router.routeRevenue();

        feeEscrow.addCredit{value: 0.5 ether}(address(router));
        router.claimPonsFees();
        uint256 nextRouteAt = router.lastRouteAt() + router.ROUTE_INTERVAL();
        vm.expectRevert(abi.encodeWithSelector(MuppetRevenueRouter.RouteCooldown.selector, nextRouteAt));
        router.routeRevenue();
        assertEq(router.unroutedRevenue(), 0.5 ether);

        vm.warp(nextRouteAt);
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
}
