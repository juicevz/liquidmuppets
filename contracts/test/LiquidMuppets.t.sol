// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockYieldPool} from "../src/mocks/MockYieldPool.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";

contract LiquidMuppetsTest is Test {
    MockERC20 internal usdg;
    MockERC20 internal weth;
    MockYieldPool internal stablePool;
    MockYieldPool internal ethPool;
    PolicyExecutor internal policy;
    LiquidMuppetsFactory internal factory;
    KeyMarketplace internal market;

    address internal creator = makeAddr("creator");
    address internal depositor = makeAddr("depositor");
    address internal buyer = makeAddr("buyer");
    address payable internal treasury = payable(makeAddr("treasury"));

    function setUp() public {
        usdg = new MockERC20("Test USDG", "tUSDG", 6, 10_000e6);
        weth = new MockERC20("Test WETH", "tWETH", 18, 10 ether);
        stablePool = new MockYieldPool(usdg);
        ethPool = new MockYieldPool(weth);
        policy = new PolicyExecutor(address(this));
        market = new KeyMarketplace(address(this), treasury, 300);
        factory = new LiquidMuppetsFactory(address(this), policy, market);
        policy.setFactory(address(factory));
        policy.setKeeper(address(this), true);
        market.setFactory(address(factory));

        factory.setTaskConfig(
            0,
            LiquidMuppetsFactory.TaskConfig({
                asset: usdg,
                adapter: stablePool,
                sharePrefix: "mUSDG",
                maxSingleBps: 9_000,
                maxDailyBps: 9_000,
                maxAllocationBps: 9_000,
                cooldownSeconds: 12 hours,
                depositCap: 1_000_000e6,
                enabled: true
            })
        );
        factory.setTaskConfig(
            1,
            LiquidMuppetsFactory.TaskConfig({
                asset: weth,
                adapter: ethPool,
                sharePrefix: "mETH",
                maxSingleBps: 8_500,
                maxDailyBps: 8_500,
                maxAllocationBps: 8_500,
                cooldownSeconds: 6 hours,
                depositCap: 1_000 ether,
                enabled: true
            })
        );

        usdg.mint(depositor, 10_000e6);
        usdg.mint(address(this), 10_000e6);
        vm.deal(buyer, 10 ether);
    }

    function testCreatorChoosesPetAndTaskIndependently() public {
        (uint256 id, address vaultAddress, address keyAddress) = _createAgent(6, 0, "golden clerk", "GOLD");
        LiquidMuppetsFactory.AgentRecord memory record = factory.getAgent(id);

        assertEq(record.petId, 6);
        assertEq(record.taskId, 0);
        assertEq(record.vault, vaultAddress);
        assertEq(record.key, keyAddress);
        assertEq(AgentKey(keyAddress).balanceOf(creator), 100);
        assertEq(AgentKey(keyAddress).decimals(), 0);
        assertEq(StrategyVault(vaultAddress).symbol(), "mUSDG-GOLD");
    }

    function testDepositAllocateSeedYieldAndRedeem() public {
        (, address vaultAddress,) = _createAgent(0, 0, "quiet range", "QUIET");
        StrategyVault vault = StrategyVault(vaultAddress);

        vm.startPrank(depositor);
        usdg.approve(vaultAddress, 1_000e6);
        uint256 shares = vault.deposit(1_000e6, depositor);
        vm.stopPrank();
        assertEq(shares, 1_000e18);
        assertEq(vault.totalAssets(), 1_000e6);

        policy.executeAllocate(vaultAddress, 900e6);
        assertEq(vault.idleAssets(), 100e6);
        assertEq(vault.deployedAssets(), 900e6);

        usdg.approve(address(stablePool), 100e6);
        stablePool.seedYield(vaultAddress, 100e6);
        assertEq(vault.totalAssets(), 1_100e6);
        assertGt(vault.convertToAssets(shares), 1_099e6);

        uint256 depositorShares = vault.balanceOf(depositor);
        vm.prank(depositor);
        uint256 redeemed = vault.redeem(depositorShares, depositor, depositor);
        assertGt(redeemed, 1_099e6);
        assertEq(vault.totalSupply(), 0);
    }

    function testVaultDepositCapIsEnforced() public {
        (, address vaultAddress,) = _createAgent(0, 0, "capped route", "CAP");
        StrategyVault vault = StrategyVault(vaultAddress);
        usdg.mint(depositor, 1_000_001e6);

        vm.startPrank(depositor);
        usdg.approve(vaultAddress, type(uint256).max);
        vault.deposit(1_000_000e6, depositor);
        vm.expectRevert();
        vault.deposit(1, depositor);
        vm.stopPrank();

        assertEq(vault.maxDeposit(depositor), 0);
        assertEq(vault.totalAssets(), 1_000_000e6);
    }

    function testCooldownStopsRepeatedKeeperAction() public {
        (, address vaultAddress,) = _createAgent(1, 0, "patient frog", "FROG");
        StrategyVault vault = StrategyVault(vaultAddress);
        vm.startPrank(depositor);
        usdg.approve(vaultAddress, 1_000e6);
        vault.deposit(1_000e6, depositor);
        vm.stopPrank();

        policy.executeAllocate(vaultAddress, 400e6);
        vm.expectRevert(PolicyExecutor.CooldownActive.selector);
        policy.executeAllocate(vaultAddress, 100e6);
    }

    function testCreatorCanPauseRenewAndRunBoundedAllocation() public {
        (, address vaultAddress,) = _createAgent(4, 0, "plum lender", "LEND");
        vm.prank(creator);
        policy.setPaused(vaultAddress, true);
        (,,,,,,,,, bool paused,) = policy.policies(vaultAddress);
        assertTrue(paused);

        uint40 nextExpiry = uint40(block.timestamp + 180 days);
        vm.prank(creator);
        policy.renewPolicy(vaultAddress, nextExpiry);
        (,,,,, uint40 expiresAt,,,,,) = policy.policies(vaultAddress);
        assertEq(expiresAt, nextExpiry);

        vm.prank(creator);
        policy.setPaused(vaultAddress, false);

        vm.startPrank(depositor);
        usdg.approve(vaultAddress, 100e6);
        StrategyVault(vaultAddress).deposit(100e6, depositor);
        vm.stopPrank();

        vm.prank(creator);
        policy.executeAllocate(vaultAddress, 90e6);
        assertEq(StrategyVault(vaultAddress).deployedAssets(), 90e6);
    }

    function testCreatorCanRecallTheWholePositionWithoutAStaleAmount() public {
        (, address vaultAddress,) = _createAgent(4, 0, "recallable route", "BACK");
        vm.startPrank(depositor);
        usdg.approve(vaultAddress, 100e6);
        StrategyVault(vaultAddress).deposit(100e6, depositor);
        vm.stopPrank();
        vm.prank(creator);
        policy.executeAllocate(vaultAddress, 90e6);

        vm.prank(creator);
        uint256 recalled = policy.executeRecallAll(vaultAddress);

        assertEq(recalled, 90e6);
        assertEq(StrategyVault(vaultAddress).deployedAssets(), 0);
        assertEq(StrategyVault(vaultAddress).idleAssets(), 100e6);
    }

    function testRecenterIsAtomicAndReopensAtThePolicyTarget() public {
        (, address vaultAddress,) = _createAgent(4, 0, "moving route", "MOVE");
        vm.startPrank(depositor);
        usdg.approve(vaultAddress, 100e6);
        StrategyVault(vaultAddress).deposit(100e6, depositor);
        vm.stopPrank();
        vm.prank(creator);
        policy.executeAllocate(vaultAddress, 90e6);
        vm.warp(block.timestamp + 1 days);

        vm.prank(creator);
        (uint256 recalled, uint256 allocated) = policy.executeRecenter(vaultAddress);

        assertEq(recalled, 90e6);
        assertEq(allocated, 90e6);
        assertEq(StrategyVault(vaultAddress).deployedAssets(), 90e6);
        assertEq(StrategyVault(vaultAddress).idleAssets(), 10e6);
    }

    function testKeyAskSettlesAndFeeCannotTouchVault() public {
        (, address vaultAddress, address keyAddress) = _createAgent(2, 0, "stone desk", "STONE");
        AgentKey key = AgentKey(keyAddress);
        vm.startPrank(creator);
        key.approve(address(market), 10);
        uint256 listingId = market.createListing(key, 10, 0.01 ether);
        vm.stopPrank();

        uint256 treasuryBefore = treasury.balance;
        vm.prank(buyer);
        market.buy{value: 0.0206 ether}(listingId, 2);

        assertEq(key.balanceOf(buyer), 2);
        assertEq(treasury.balance - treasuryBefore, 0.0006 ether);
        assertEq(StrategyVault(vaultAddress).totalAssets(), 0);
    }

    function testBindingBurnsLiquidityButRecordsAccess() public {
        (,, address keyAddress) = _createAgent(3, 0, "plum cat", "PLUM");
        AgentKey key = AgentKey(keyAddress);
        vm.prank(creator);
        key.bind(3);
        assertEq(key.balanceOf(creator), 97);
        assertEq(key.boundBalance(creator), 3);
        assertEq(key.totalBound(), 3);
    }

    function testMarketplaceRejectsUnregisteredZeroDecimalToken() public {
        MockERC20 fakeKey = new MockERC20("Fake Key", "FAKE", 0, 100);
        fakeKey.mint(creator, 10);
        vm.startPrank(creator);
        fakeKey.approve(address(market), 1);
        vm.expectRevert(KeyMarketplace.InvalidKey.selector);
        market.createListing(fakeKey, 1, 0.01 ether);
        vm.stopPrank();
    }

    function testOfferSnapshotsFeeAndRefundsRoundingDust() public {
        (,, address keyAddress) = _createAgent(5, 0, "frog router", "ROUTE");
        AgentKey key = AgentKey(keyAddress);
        vm.deal(buyer, 1 ether);
        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        uint256 offerId = market.createOffer{value: 35}(key, 2, 17);
        market.setFee(1_000);

        vm.startPrank(creator);
        key.approve(address(market), 2);
        market.acceptOffer(offerId, 1);
        market.acceptOffer(offerId, 1);
        vm.stopPrank();

        (,,,, uint256 escrow, bool active) = market.offers(offerId);
        assertEq(market.offerFeeBps(offerId), 300);
        assertEq(escrow, 0);
        assertFalse(active);
        assertEq(key.balanceOf(buyer), 2);
        assertEq(buyer.balance, buyerBefore - 34);
        assertEq(creator.balance, 34);
    }

    function _createAgent(uint8 petId, uint8 taskId, string memory name, string memory symbol)
        internal
        returns (uint256 id, address vault, address key)
    {
        vm.prank(creator);
        return factory.createAgent(petId, taskId, name, symbol, 100, 0.01 ether);
    }
}
