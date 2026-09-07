// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {MuppetAgentBond} from "../src/MuppetAgentBond.sol";
import {IMuppetAgentBondRewards, IWrappedRevenueToken, MuppetRevenueRouter} from "../src/MuppetRevenueRouter.sol";

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

contract MuppetRevenueTest is Test {
    MockERC20 internal muppets;
    MockWrappedRevenueToken internal weth;
    MockPonsFeeEscrow internal feeEscrow;
    RevenueGovernanceHarness internal governance;
    RevenueGovernanceHarness internal reserve;
    RevenueGovernanceHarness internal operations;
    KeyMarketplace internal market;
    MuppetAgentBond internal bond;
    MuppetRevenueRouter internal router;
    AgentKey internal key;

    address internal holder = makeAddr("holder");
    address internal buyer = makeAddr("buyer");

    function setUp() public {
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
        router = new MuppetRevenueRouter(
            address(this),
            address(feeEscrow),
            IWrappedRevenueToken(address(weth)),
            IMuppetAgentBondRewards(address(bond)),
            payable(address(reserve)),
            payable(address(operations))
        );
        bond.setKeyRegistry(address(market), true);
        bond.setRewardNotifier(address(router));
        router.setMarketplace(address(market), true);
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
        _bindAndBond(1);
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
        assertEq(bond.claimReward(), 1.175 ether);
        assertEq(weth.balanceOf(holder), 1.175 ether);
        assertEq(bond.totalRewardsClaimed(), 1.175 ether);
    }

    function testRewardsQueueUntilARealUnitExists() public {
        feeEscrow.addCredit{value: 1 ether}(address(router));
        router.claimPonsFees();
        router.routeRevenue();
        assertEq(router.pendingBondRewardsNative(), 0.5 ether);
        assertEq(router.totalBondRewardsDelivered(), 0);

        _bindAndBond(1);
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
        assertEq(router.unroutedRevenue(), 0.03 ether);
        assertEq(router.totalFundingReceived(), 0);
    }

    function testRevenueAccumulatesBetweenWeeklyRoutes() public {
        _bindAndBond(1);
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
        _bindAndBond(1);
        uint256 unlockTimestamp = bond.lockedUntil(holder, address(key));

        vm.expectRevert(abi.encodeWithSelector(MuppetAgentBond.LockActive.selector, unlockTimestamp));
        vm.prank(holder);
        bond.unbond(address(key), 1);

        vm.warp(unlockTimestamp);
        vm.prank(holder);
        bond.unbond(address(key), 1);

        assertEq(muppets.balanceOf(holder), 60_000 ether);
        assertEq(bond.rewardUnits(holder), 0);
        assertEq(key.boundBalance(holder), 1);
        assertEq(key.balanceOf(holder), 99);
    }

    function _bindAndBond(uint256 units) private {
        vm.startPrank(holder);
        key.bind(units);
        muppets.approve(address(bond), units * 15_000 ether);
        bond.bond(address(key), units);
        vm.stopPrank();
    }
}
