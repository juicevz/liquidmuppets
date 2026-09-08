// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IStrategyAdapter} from "../src/interfaces/IStrategyAdapter.sol";
import {IEZWrapper, IUniswapV3PoolLike} from "../src/interfaces/IEZManager.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {
    IKeyMarketplaceRegistry,
    ILegacyLiquidMuppetsFactory,
    IMuppetBondBalance,
    LiquidMuppetsFactoryV2
} from "../src/LiquidMuppetsFactoryV2.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {IKeyRevenueReceiver, KeyMarketplaceV2} from "../src/KeyMarketplaceV2.sol";
import {FeeRwaReserve} from "../src/FeeRwaReserve.sol";
import {MuppetAgentBond} from "../src/MuppetAgentBond.sol";
import {
    IMuppetAgentBondRewards,
    IMuppetBuybackVaultFunding,
    IWrappedRevenueToken,
    MuppetRevenueRouter
} from "../src/MuppetRevenueRouter.sol";
import {IMuppetsBuybackExecutor, MuppetBuybackVault} from "../src/MuppetBuybackVault.sol";
import {IUniversalRouter, PonsV4MuppetsBuybackExecutor} from "../src/PonsV4MuppetsBuybackExecutor.sol";
import {EZManagerPoolAdapter, IAggregatorV3Like} from "../src/adapters/EZManagerPoolAdapter.sol";

interface ISafeLike {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @notice Deploys FactoryV2, closes the V1 launch path, and hands every protocol owner role to a Safe.
contract DeployFactoryV2 is Script {
    uint256 private constant CHAIN_ID = 4663;
    uint256 private constant MINIMUM_ACCESS_BALANCE = 15_000 ether;
    uint40 private constant AGENT_BOND_LOCK = 30 days;
    uint256 private constant MAX_BUYBACK_WEI = 0.01 ether;
    uint40 private constant BUYBACK_COOLDOWN = 30 minutes;
    address private constant PONS_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address private constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address private constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address private constant BUYBACK_KEEPER = 0xA5960A69E57F4EbC924503bC829f1E6670BfBA51;
    IERC20 private constant MUPPETS = IERC20(0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189);
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    IERC20 private constant WETH = IERC20(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    LiquidMuppetsFactory private constant LEGACY_FACTORY =
        LiquidMuppetsFactory(0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460);
    PolicyExecutor private constant POLICY = PolicyExecutor(0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc);
    KeyMarketplace private constant LEGACY_MARKET = KeyMarketplace(payable(0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb));
    FeeRwaReserve private constant RESERVE = FeeRwaReserve(payable(0xF10DA007314bB3e7B34FE06bB5c590190dcE9765));
    IStrategyAdapter private constant STABLE_ADAPTER = IStrategyAdapter(0x169EfD23f67811709C0Db823f7c82fcF2732781d);
    IStrategyAdapter private constant RANGE_ADAPTER = IStrategyAdapter(0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d);
    IStrategyAdapter private constant LAUNCH_ADAPTER = IStrategyAdapter(0x956127B0B586B9427182FCd9325efe032E9B5181);
    IEZWrapper private constant EZ_WRAPPER = IEZWrapper(0x6F81790Ebac25497be379Dc66143fb298663Ae11);
    IUniswapV3PoolLike private constant NVDA_USDG_POOL = IUniswapV3PoolLike(0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3);
    IAggregatorV3Like private constant NVDA_FEED = IAggregatorV3Like(0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15);

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address safe = vm.envAddress("SAFE_MULTISIG");
        require(safe.code.length != 0, "Safe has no code");
        address[] memory safeOwners = ISafeLike(safe).getOwners();
        uint256 threshold = ISafeLike(safe).getThreshold();
        require(safeOwners.length >= 2 && threshold >= 2 && threshold <= safeOwners.length, "invalid Safe policy");
        require(IERC20Metadata(address(MUPPETS)).decimals() == 18, "unexpected MUPPETS decimals");
        require(
            LEGACY_FACTORY.owner() == deployer && POLICY.owner() == deployer && LEGACY_MARKET.owner() == deployer
                && RESERVE.owner() == deployer,
            "deployer is not every current owner"
        );
        require(address(POLICY.factory()) == address(LEGACY_FACTORY), "policy factory changed");
        require(LEGACY_MARKET.factory() == address(LEGACY_FACTORY), "legacy market factory changed");

        uint256 deploymentBlock = block.number;
        vm.startBroadcast(deployerKey);
        MuppetAgentBond agentBond =
            new MuppetAgentBond(deployer, MUPPETS, WETH, MINIMUM_ACCESS_BALANCE, AGENT_BOND_LOCK);
        PonsV4MuppetsBuybackExecutor buybackExecutor =
            new PonsV4MuppetsBuybackExecutor(MUPPETS, IUniversalRouter(UNIVERSAL_ROUTER), PONS_HOOK, 200);
        MuppetBuybackVault buybackVault = new MuppetBuybackVault(
            deployer, IMuppetsBuybackExecutor(address(buybackExecutor)), safe, MAX_BUYBACK_WEI, BUYBACK_COOLDOWN
        );
        MuppetRevenueRouter revenueRouter = new MuppetRevenueRouter(
            deployer,
            PONS_FEE_ESCROW,
            IWrappedRevenueToken(address(WETH)),
            IMuppetAgentBondRewards(address(agentBond)),
            IMuppetBuybackVaultFunding(address(buybackVault)),
            payable(address(RESERVE)),
            payable(safe)
        );
        buybackVault.setRevenueRouter(address(revenueRouter));
        buybackVault.setKeeper(BUYBACK_KEEPER, true);
        KeyMarketplaceV2 marketV2 = new KeyMarketplaceV2(deployer, IKeyRevenueReceiver(address(revenueRouter)), 300);
        agentBond.setKeyRegistry(address(LEGACY_MARKET), true);
        agentBond.setKeyRegistry(address(marketV2), true);
        agentBond.setRewardNotifier(address(revenueRouter));
        revenueRouter.setMarketplace(address(LEGACY_MARKET), true);
        revenueRouter.setKeyMarketplace(address(marketV2), true);
        LiquidMuppetsFactoryV2 factoryV2 = new LiquidMuppetsFactoryV2(
            deployer,
            MUPPETS,
            IMuppetBondBalance(address(agentBond)),
            MINIMUM_ACCESS_BALANCE,
            POLICY,
            IKeyMarketplaceRegistry(address(marketV2)),
            ILegacyLiquidMuppetsFactory(address(LEGACY_FACTORY))
        );
        EZManagerPoolAdapter nvdaAdapter =
            new EZManagerPoolAdapter(USDG, EZ_WRAPPER, NVDA_USDG_POOL, NVDA_FEED, 1_200, 300, 3 days, 10e6);
        marketV2.setFactory(address(factoryV2));
        _setPresets(factoryV2);
        _setCurrentTemplates(factoryV2);
        _setNvdaTemplate(factoryV2, nvdaAdapter);

        // This switch makes every direct V1 createAgent call revert at policy registration.
        // Existing V1 vault policies, recalls, redemptions, asks and bids remain untouched.
        POLICY.setFactory(address(factoryV2));
        LEGACY_MARKET.setTreasury(payable(address(revenueRouter)));

        LEGACY_FACTORY.transferOwnership(safe);
        LEGACY_MARKET.transferOwnership(safe);
        POLICY.transferOwnership(safe);
        RESERVE.transferOwnership(safe);
        agentBond.transferOwnership(safe);
        revenueRouter.transferOwnership(safe);
        buybackVault.transferOwnership(safe);
        marketV2.transferOwnership(safe);
        factoryV2.transferOwnership(safe);
        vm.stopBroadcast();

        require(factoryV2.owner() == safe && factoryV2.governanceReady(), "FactoryV2 governance incomplete");
        require(!factoryV2.launchesEnabled(), "launches must remain off before source verification");
        require(
            agentBond.paused() && revenueRouter.paused() && buybackVault.paused(),
            "revenue contracts must remain paused"
        );
        require(agentBond.rewardNotifier() == address(revenueRouter), "revenue notifier mismatch");
        require(buybackVault.revenueRouter() == address(revenueRouter), "buyback router mismatch");
        require(buybackVault.keepers(BUYBACK_KEEPER), "buyback keeper missing");
        require(LEGACY_MARKET.treasury() == address(revenueRouter), "legacy market routing inactive");
        require(address(marketV2.revenueRouter()) == address(revenueRouter), "V2 market routing inactive");
        require(POLICY.factory() == address(factoryV2), "FactoryV2 policy registration inactive");
        require(factoryV2.legacyAgentCount() == LEGACY_FACTORY.agentCount(), "legacy count mismatch");

        console2.log("safe", safe);
        console2.log("safeThreshold", threshold);
        console2.log("factoryV2", address(factoryV2));
        console2.log("keyMarketplaceV2", address(marketV2));
        console2.log("agentBond", address(agentBond));
        console2.log("revenueRouter", address(revenueRouter));
        console2.log("buybackVault", address(buybackVault));
        console2.log("buybackExecutor", address(buybackExecutor));
        console2.log("nvdaAdapter", address(nvdaAdapter));
        console2.log("legacyFactory", address(LEGACY_FACTORY));
        console2.log("legacyKeyMarketplace", address(LEGACY_MARKET));
        console2.log("legacyAgentCount", factoryV2.legacyAgentCount());

        if (vm.envOr("WRITE_DEPLOYMENT_RECEIPT", false)) {
            string memory root = "factoryV2Deployment";
            vm.serializeUint(root, "chainId", block.chainid);
            vm.serializeUint(root, "deploymentBlock", deploymentBlock);
            vm.serializeAddress(root, "deployer", deployer);
            vm.serializeAddress(root, "owner", safe);
            vm.serializeUint(root, "safeThreshold", threshold);
            vm.serializeAddress(root, "factory", address(factoryV2));
            vm.serializeAddress(root, "keyMarketplace", address(marketV2));
            vm.serializeAddress(root, "agentBond", address(agentBond));
            vm.serializeAddress(root, "revenueRouter", address(revenueRouter));
            vm.serializeAddress(root, "buybackVault", address(buybackVault));
            vm.serializeAddress(root, "buybackExecutor", address(buybackExecutor));
            vm.serializeAddress(root, "buybackKeeper", BUYBACK_KEEPER);
            vm.serializeAddress(root, "universalRouter", UNIVERSAL_ROUTER);
            vm.serializeAddress(root, "ponsHook", PONS_HOOK);
            vm.serializeAddress(root, "ponsFeeEscrow", PONS_FEE_ESCROW);
            vm.serializeAddress(root, "nvdaAdapter", address(nvdaAdapter));
            vm.serializeAddress(root, "legacyFactory", address(LEGACY_FACTORY));
            vm.serializeAddress(root, "legacyKeyMarketplace", address(LEGACY_MARKET));
            vm.serializeAddress(root, "policyExecutor", address(POLICY));
            vm.serializeAddress(root, "feeRwaReserve", address(RESERVE));
            vm.serializeAddress(root, "muppetsToken", address(MUPPETS));
            vm.serializeAddress(root, "WETH", address(WETH));
            vm.serializeString(root, "minimumMuppetsRaw", vm.toString(MINIMUM_ACCESS_BALANCE));
            vm.serializeUint(root, "legacyAgentCount", factoryV2.legacyAgentCount());
            string memory json = vm.serializeString(root, "status", "deployed-pending-verification");
            vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/robinhood-mainnet-v2.json"));
        }
    }

    function _setPresets(LiquidMuppetsFactoryV2 factoryV2) private {
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

    function _setCurrentTemplates(LiquidMuppetsFactoryV2 factoryV2) private {
        factoryV2.setTaskConfig(
            0,
            LiquidMuppetsFactoryV2.TaskConfig({
                asset: USDG,
                adapter: STABLE_ADAPTER,
                sharePrefix: "mUSDG",
                routeId: keccak256("MORPHO_USDE_USDG_C845DA65"),
                maxSingleBps: 9_000,
                maxDailyBps: 9_000,
                maxAllocationBps: 9_000,
                cooldownSeconds: 30 minutes,
                depositCap: 10_000e6,
                allowedPresetMask: 0,
                enabled: true
            })
        );
        factoryV2.setTaskConfig(
            1,
            LiquidMuppetsFactoryV2.TaskConfig({
                asset: WETH,
                adapter: RANGE_ADAPTER,
                sharePrefix: "mETH",
                routeId: keccak256("EZMANAGER_WETH_USDG_100"),
                maxSingleBps: 8_500,
                maxDailyBps: 8_500,
                maxAllocationBps: 8_500,
                cooldownSeconds: 6 hours,
                depositCap: 1 ether,
                allowedPresetMask: 7,
                enabled: true
            })
        );
        factoryV2.setTaskConfig(
            2,
            LiquidMuppetsFactoryV2.TaskConfig({
                asset: WETH,
                adapter: LAUNCH_ADAPTER,
                sharePrefix: "mLAUNCH",
                routeId: keccak256("ISOLATED_WETH_LAUNCH_RESERVE"),
                maxSingleBps: 1_000,
                maxDailyBps: 1_000,
                maxAllocationBps: 1_000,
                cooldownSeconds: 30 minutes,
                depositCap: 0.25 ether,
                allowedPresetMask: 0,
                enabled: true
            })
        );
    }

    function _setNvdaTemplate(LiquidMuppetsFactoryV2 factoryV2, EZManagerPoolAdapter nvdaAdapter) private {
        factoryV2.setTaskConfig(
            4,
            LiquidMuppetsFactoryV2.TaskConfig({
                asset: USDG,
                adapter: nvdaAdapter,
                sharePrefix: "mNVDA",
                routeId: keccak256("EZMANAGER_NVDA_USDG_500"),
                maxSingleBps: 6_000,
                maxDailyBps: 7_500,
                maxAllocationBps: 7_500,
                cooldownSeconds: 1 days,
                depositCap: 2_500e6,
                allowedPresetMask: 7,
                enabled: true
            })
        );
    }
}
