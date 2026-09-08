// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IStrategyAdapter} from "../src/interfaces/IStrategyAdapter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockYieldPool} from "../src/mocks/MockYieldPool.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {
    IKeyMarketplaceRegistry,
    ILegacyLiquidMuppetsFactory,
    IMuppetBondBalance,
    LiquidMuppetsFactoryV2
} from "../src/LiquidMuppetsFactoryV2.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";

contract GovernanceHarness {}

contract MockBondBalance is IMuppetBondBalance {
    mapping(address account => uint256 amount) public bondedBalance;

    function setBondedBalance(address account, uint256 amount) external {
        bondedBalance[account] = amount;
    }
}

contract LiquidMuppetsFactoryV2Test is Test {
    MockERC20 internal asset;
    MockERC20 internal accessToken;
    MockYieldPool internal adapter;
    PolicyExecutor internal policy;
    KeyMarketplace internal legacyMarket;
    KeyMarketplace internal marketV2;
    LiquidMuppetsFactory internal legacyFactory;
    LiquidMuppetsFactoryV2 internal factoryV2;
    MockBondBalance internal bondBalance;

    address internal legacyCreator = makeAddr("legacyCreator");
    address internal creator = makeAddr("creator");
    address payable internal treasury = payable(makeAddr("treasury"));

    function setUp() public {
        asset = new MockERC20("USDG", "USDG", 6, 10_000e6);
        accessToken = new MockERC20("Muppets", "MUPPETS", 18, 15_000 ether);
        adapter = new MockYieldPool(asset);
        policy = new PolicyExecutor(address(this));
        legacyMarket = new KeyMarketplace(address(this), treasury, 300);
        legacyFactory = new LiquidMuppetsFactory(address(this), policy, legacyMarket);
        policy.setFactory(address(legacyFactory));
        legacyMarket.setFactory(address(legacyFactory));
        legacyFactory.setTaskConfig(
            0,
            LiquidMuppetsFactory.TaskConfig({
                asset: asset,
                adapter: adapter,
                sharePrefix: "mUSDG",
                maxSingleBps: 9_000,
                maxDailyBps: 9_000,
                maxAllocationBps: 9_000,
                cooldownSeconds: 30 minutes,
                depositCap: 10_000e6,
                enabled: true
            })
        );
        vm.prank(legacyCreator);
        legacyFactory.createAgent(0, 0, "legacy frog", "LFROG", 100, 0.01 ether);

        marketV2 = new KeyMarketplace(address(this), treasury, 300);
        bondBalance = new MockBondBalance();
        factoryV2 = new LiquidMuppetsFactoryV2(
            address(this),
            accessToken,
            bondBalance,
            15_000 ether,
            policy,
            IKeyMarketplaceRegistry(address(marketV2)),
            ILegacyLiquidMuppetsFactory(address(legacyFactory))
        );
        policy.setFactory(address(factoryV2));
        marketV2.setFactory(address(factoryV2));
        _setPresets();
        factoryV2.setTaskConfig(
            3,
            LiquidMuppetsFactoryV2.TaskConfig({
                asset: IERC20(asset),
                adapter: IStrategyAdapter(adapter),
                sharePrefix: "mAAPL",
                routeId: keccak256("AAPL_USDG_RANGE"),
                maxSingleBps: 6_000,
                maxDailyBps: 6_000,
                maxAllocationBps: 6_000,
                cooldownSeconds: 1 days,
                depositCap: 2_500e6,
                allowedPresetMask: 7,
                enabled: true
            })
        );
        factoryV2.setLaunchesEnabled(true);
    }

    function testCreatorSlotsScaleWithEachLaunchAndLeaveTheBalanceReusable() public {
        accessToken.mint(creator, 14_999 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidMuppetsFactoryV2.InsufficientAccessBalance.selector, 14_999 ether, 15_000 ether
            )
        );
        vm.prank(creator);
        factoryV2.createAgent(1, 3, "apple fox", "APPLE", 100, 0.01 ether);

        accessToken.mint(creator, 1 ether);
        vm.prank(creator);
        factoryV2.createAgent(1, 3, "apple fox", "APPLE", 100, 0.01 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidMuppetsFactoryV2.InsufficientAccessBalance.selector, 15_000 ether, 30_000 ether
            )
        );
        vm.prank(creator);
        factoryV2.createAgent(2, 3, "second fox", "FOX2", 100, 0.01 ether);

        accessToken.mint(creator, 15_000 ether);
        vm.prank(creator);
        factoryV2.createAgent(2, 3, "second fox", "FOX2", 100, 0.01 ether);

        (uint256 balance, uint256 slots, uint256 used, uint256 available, uint256 nextRequired) =
            factoryV2.creatorSlotState(creator);
        assertEq(balance, 30_000 ether);
        assertEq(slots, 2);
        assertEq(used, 2);
        assertEq(available, 0);
        assertEq(nextRequired, 45_000 ether);
        assertEq(accessToken.balanceOf(creator), 30_000 ether);
        assertEq(factoryV2.agentCount(), 3);
        assertEq(factoryV2.newAgentCount(), 2);
    }

    function testBondedMuppetsStillCountTowardCreatorSlots() public {
        accessToken.mint(creator, 15_000 ether);
        bondBalance.setBondedBalance(creator, 15_000 ether);

        vm.startPrank(creator);
        factoryV2.createAgent(1, 3, "liquid slot", "LIQ", 100, 0.01 ether);
        factoryV2.createAgent(2, 3, "bonded slot", "BOND", 100, 0.01 ether);
        vm.stopPrank();

        (uint256 balance, uint256 slots, uint256 used, uint256 available, uint256 nextRequired) =
            factoryV2.creatorSlotState(creator);
        assertEq(balance, 30_000 ether);
        assertEq(slots, 2);
        assertEq(used, 2);
        assertEq(available, 0);
        assertEq(nextRequired, 45_000 ether);

        (uint256 liquid, uint256 bonded, uint256 total) = factoryV2.creatorAccessBalances(creator);
        assertEq(liquid, 15_000 ether);
        assertEq(bonded, 15_000 ether);
        assertEq(total, 30_000 ether);
    }

    function testLegacyMuppetConsumesOneCreatorSlot() public {
        accessToken.mint(legacyCreator, 15_000 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidMuppetsFactoryV2.InsufficientAccessBalance.selector, 15_000 ether, 30_000 ether
            )
        );
        vm.prank(legacyCreator);
        factoryV2.createAgent(1, 3, "second legacy", "LEG2", 100, 0.01 ether);

        (uint256 balance, uint256 slots, uint256 used, uint256 available, uint256 nextRequired) =
            factoryV2.creatorSlotState(legacyCreator);
        assertEq(balance, 15_000 ether);
        assertEq(slots, 1);
        assertEq(used, 1);
        assertEq(available, 0);
        assertEq(nextRequired, 30_000 ether);
    }

    function testBalanceDropDoesNotTouchExistingVaultOrAgentKeyMarket() public {
        accessToken.mint(creator, 15_000 ether);
        vm.prank(creator);
        (, address vaultAddress, address key) = factoryV2.createAgent(1, 3, "independent fox", "IFX", 100, 0.01 ether);

        vm.prank(creator);
        accessToken.transfer(makeAddr("receiver"), 15_000 ether);

        StrategyVault vault = StrategyVault(vaultAddress);
        asset.mint(creator, 100e6);
        vm.startPrank(creator);
        asset.approve(address(vault), 100e6);
        uint256 shares = vault.deposit(100e6, creator);
        uint256 redeemed = vault.redeem(shares, creator, creator);
        vm.stopPrank();

        assertEq(accessToken.balanceOf(creator), 0);
        assertEq(redeemed, 100e6);
        assertEq(IERC20(key).balanceOf(creator), 100);
        assertTrue(marketV2.approvedKeys(key));
    }

    function testLegacyRecordsAndCreatorIdsRemainReadable() public view {
        LiquidMuppetsFactoryV2.AgentRecord memory legacy = factoryV2.getAgent(0);
        assertEq(legacy.creator, legacyCreator);
        assertEq(legacy.name, "legacy frog");
        assertEq(factoryV2.getAgentPreset(0), factoryV2.DEFAULT_POLICY());

        uint256[] memory ids = factoryV2.getCreatorAgentIds(legacyCreator);
        assertEq(ids.length, 1);
        assertEq(ids[0], 0);
    }

    function testPresetChangesTheRegisteredPolicyForTheNewVault() public {
        accessToken.mint(creator, 15_000 ether);
        vm.prank(creator);
        (uint256 id, address vault,) =
            factoryV2.createAgentWithPreset(2, 3, 0, "defensive stone", "STONE", 200, 0.02 ether);

        (, uint16 maxSingleBps, uint16 maxDailyBps, uint16 maxAllocationBps, uint32 cooldownSeconds,,,,,,) =
            policy.policies(vault);
        assertEq(maxSingleBps, 2_000);
        assertEq(maxDailyBps, 3_000);
        assertEq(maxAllocationBps, 6_000);
        assertEq(cooldownSeconds, 1 days);
        assertEq(factoryV2.getAgentPreset(id), 0);
    }

    function testDisallowedPresetFailsClosed() public {
        LiquidMuppetsFactoryV2.TaskConfig memory config = factoryV2.getTaskConfig(3);
        config.allowedPresetMask = 1;
        factoryV2.setTaskConfig(3, config);
        accessToken.mint(creator, 15_000 ether);

        vm.expectRevert(LiquidMuppetsFactoryV2.InvalidPreset.selector);
        vm.prank(creator);
        factoryV2.createAgentWithPreset(2, 3, 2, "active stone", "STONE", 200, 0.02 ether);
    }

    function testLegacyVaultCanStillDepositAndRedeemAfterFactoryMigration() public {
        StrategyVault vault = StrategyVault(legacyFactory.getAgent(0).vault);
        asset.mint(creator, 100e6);
        vm.startPrank(creator);
        asset.approve(address(vault), 100e6);
        uint256 shares = vault.deposit(100e6, creator);
        uint256 redeemed = vault.redeem(shares, creator, creator);
        vm.stopPrank();

        assertEq(redeemed, 100e6);
        assertEq(asset.balanceOf(creator), 100e6);
    }

    function testOwnershipCanOnlyMoveToDeployedGovernanceCode() public {
        vm.expectRevert(LiquidMuppetsFactoryV2.ContractGovernanceRequired.selector);
        factoryV2.transferOwnership(makeAddr("eoa"));

        GovernanceHarness governance = new GovernanceHarness();
        factoryV2.transferOwnership(address(governance));
        assertEq(factoryV2.owner(), address(governance));
        assertTrue(factoryV2.governanceReady());
    }

    function testMultisigLaunchSwitchFailsClosed() public {
        factoryV2.setLaunchesEnabled(false);
        accessToken.mint(creator, 15_000 ether);

        vm.expectRevert(LiquidMuppetsFactoryV2.LaunchesDisabled.selector);
        vm.prank(creator);
        factoryV2.createAgent(1, 3, "paused fox", "PAUSE", 100, 0.01 ether);
    }

    function testEoaOwnedFactoryCannotLaunchBeforeGovernanceHandoff() public {
        address eoaOwner = makeAddr("temporaryDeployer");
        KeyMarketplace anotherMarket = new KeyMarketplace(address(this), treasury, 300);
        LiquidMuppetsFactoryV2 anotherFactory = new LiquidMuppetsFactoryV2(
            eoaOwner,
            accessToken,
            IMuppetBondBalance(address(0)),
            15_000 ether,
            policy,
            IKeyMarketplaceRegistry(address(anotherMarket)),
            ILegacyLiquidMuppetsFactory(address(0))
        );
        accessToken.mint(creator, 15_000 ether);

        vm.expectRevert(LiquidMuppetsFactoryV2.ContractGovernanceRequired.selector);
        vm.prank(creator);
        anotherFactory.createAgent(0, 0, "blocked fox", "BLOCK", 100, 0.01 ether);
    }

    function _setPresets() private {
        factoryV2.setRiskPreset(
            0,
            LiquidMuppetsFactoryV2.RiskPreset({
                label: "defensive",
                maxSingleBps: 2_000,
                maxDailyBps: 3_000,
                maxAllocationBps: 6_000,
                cooldownSeconds: 1 days,
                enabled: true
            })
        );
        factoryV2.setRiskPreset(
            1,
            LiquidMuppetsFactoryV2.RiskPreset({
                label: "balanced",
                maxSingleBps: 3_500,
                maxDailyBps: 5_000,
                maxAllocationBps: 7_500,
                cooldownSeconds: 12 hours,
                enabled: true
            })
        );
        factoryV2.setRiskPreset(
            2,
            LiquidMuppetsFactoryV2.RiskPreset({
                label: "active",
                maxSingleBps: 5_000,
                maxDailyBps: 7_500,
                maxAllocationBps: 8_500,
                cooldownSeconds: 6 hours,
                enabled: true
            })
        );
    }
}
