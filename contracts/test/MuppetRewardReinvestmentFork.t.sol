// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {IMuppetRewardBuyExecutor, MuppetAgentBond} from "../src/MuppetAgentBond.sol";
import {IUniversalRouter, PonsV4MuppetsBuybackExecutor} from "../src/PonsV4MuppetsBuybackExecutor.sol";
import {RevenueGovernanceHarness} from "./MuppetRevenue.t.sol";
import {ReinvestmentKeyRegistry} from "./MuppetRewardReinvestment.t.sol";

interface IForkWrappedReward is IERC20 {
    function deposit() external payable;
}

/// @dev Uses the public dev address only via local impersonation. Every reward and bound Key is a test fixture.
/// Run with --fork-url https://rpc.mainnet.chain.robinhood.com; no signature or broadcast is involved.
contract MuppetRewardReinvestmentForkTest is Test {
    address internal constant DEV = 0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f;
    IERC20 internal constant MUPPETS = IERC20(0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189);
    IForkWrappedReward internal constant WETH = IForkWrappedReward(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IUniversalRouter internal constant ROUTER = IUniversalRouter(0x8876789976dEcBfCbBbe364623C63652db8C0904);
    address internal constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    uint256 internal constant UNIT = 15_000 ether;
    MuppetAgentBond internal bond;
    PonsV4MuppetsBuybackExecutor internal executor;
    AgentKey internal key;
    uint256 internal originalPosition;

    function setUp() public {
        if (block.chainid != 4663) return;
        executor = new PonsV4MuppetsBuybackExecutor(MUPPETS, ROUTER, PONS_HOOK, 200);
        bond = new MuppetAgentBond(
            address(this), MUPPETS, WETH, UNIT, 30 days, IMuppetRewardBuyExecutor(address(executor))
        );
        ReinvestmentKeyRegistry registry = new ReinvestmentKeyRegistry();
        RevenueGovernanceHarness governance = new RevenueGovernanceHarness();
        key = new AgentKey("Local Fork Key", "FORKKEY", DEV, 2);
        registry.register(address(key));
        bond.setKeyRegistry(address(registry), true);
        bond.setRewardNotifier(address(this));
        bond.transferOwnership(address(governance));
        governance.execute(address(bond), abi.encodeCall(MuppetAgentBond.activate, ()));

        // Local-only token storage and ETH funding. Neither changes the real dev wallet.
        deal(address(MUPPETS), DEV, UNIT);
        vm.deal(address(this), 1 ether);
        vm.startPrank(DEV);
        key.bind(2);
        MUPPETS.approve(address(bond), UNIT);
        originalPosition = bond.bond(address(key), 1);
        vm.stopPrank();
        uint40 epoch = bond.getPosition(originalPosition).firstEligibleEpoch;
        vm.warp(bond.epochStart(epoch + 1));
        WETH.deposit{value: 0.2 ether}();
        WETH.approve(address(bond), 0.2 ether);
        bond.notifyReward(epoch, 0.15 ether);
        bond.notifyKeyReward(address(key), epoch, 0.05 ether);
    }

    function testForkDevReinvestsThroughRealPonsPool() public {
        vm.skip(block.chainid != 4663, "requires Robinhood mainnet fork");
        uint256 beforeWeth = WETH.balanceOf(DEV);
        uint40 originalUnlock = bond.getPosition(originalPosition).unlockAt;
        uint256 snapshot = vm.snapshotState();
        vm.prank(DEV);
        (, uint256 quoted,,) = bond.claimBuyAndBond(
            originalPosition,
            0.001 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            UNIT,
            block.timestamp + 1 minutes
        );
        assertTrue(vm.revertToState(snapshot));
        uint256 minimumOutput = quoted * 99 / 100;
        assertGt(minimumOutput, UNIT);
        vm.prank(DEV);
        (uint256 newId, uint256 bought, uint256 globalClaimed, uint256 keyClaimed) = bond.claimBuyAndBond(
            originalPosition,
            0.001 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            minimumOutput,
            block.timestamp + 1 minutes
        );
        assertGt(bought, UNIT);
        assertGe(bought, minimumOutput);
        assertEq(globalClaimed, 0.15 ether);
        assertEq(keyClaimed, 0.05 ether);
        assertEq(bond.getPosition(newId).account, DEV);
        assertEq(bond.getPosition(originalPosition).unlockAt, originalUnlock);
        assertEq(bond.bondedBalance(DEV), 2 * UNIT);
        assertEq(MUPPETS.balanceOf(DEV), bought - UNIT);
        assertEq(WETH.balanceOf(DEV) - beforeWeth, 0.199 ether);
        assertEq(MUPPETS.balanceOf(address(bond)), 2 * UNIT);
        assertEq(WETH.balanceOf(address(bond)), 0);
        assertEq(bond.pendingTotalReward(DEV), 0);
        assertEq(address(executor).balance, 0);
        emit log_named_uint("fork measured MUPPETS bought", bought);
    }

    function testForkDevSwapSlippageFailureKeepsRewardsClaimable() public {
        vm.skip(block.chainid != 4663, "requires Robinhood mainnet fork");
        vm.prank(DEV);
        vm.expectRevert();
        bond.claimBuyAndBond(
            originalPosition,
            0.1 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            type(uint128).max,
            block.timestamp + 1 minutes
        );
        assertEq(bond.pendingTotalReward(DEV), 0.2 ether);
        assertEq(bond.accountPositionCount(DEV), 1);
        assertEq(MUPPETS.balanceOf(address(bond)), UNIT);
        assertEq(WETH.balanceOf(address(bond)), 0.2 ether);
        uint256 beforeWeth = WETH.balanceOf(DEV);
        vm.prank(DEV);
        bond.claimPositionRewards(originalPosition);
        assertEq(WETH.balanceOf(DEV) - beforeWeth, 0.2 ether);
    }

    function testForkDevExpiredQuoteDoesNotSpendOrConsumeRewards() public {
        vm.skip(block.chainid != 4663, "requires Robinhood mainnet fork");
        vm.prank(DEV);
        vm.expectRevert(MuppetAgentBond.DeadlineInvalid.selector);
        bond.claimBuyAndBond(
            originalPosition,
            0.1 ether,
            address(key),
            1,
            MuppetAgentBond.BondTerm.THIRTY_DAYS,
            UNIT,
            block.timestamp - 1
        );
        assertEq(bond.pendingTotalReward(DEV), 0.2 ether);
        assertEq(bond.bondedBalance(DEV), UNIT);
        assertEq(WETH.balanceOf(address(bond)), 0.2 ether);
        assertEq(address(executor).balance, 0);
    }
}
