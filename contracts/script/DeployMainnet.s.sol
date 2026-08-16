// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {MorphoBlueAdapter} from "../src/adapters/MorphoBlueAdapter.sol";
import {EZManagerRangeAdapter} from "../src/adapters/EZManagerRangeAdapter.sol";
import {LaunchReserveAdapter} from "../src/adapters/LaunchReserveAdapter.sol";
import {IEZWrapper, ISwapRouter02, IUniswapV3PoolLike} from "../src/interfaces/IEZManager.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";

contract DeployMainnet is Script {
    using MarketParamsLib for MarketParams;

    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant MORPHO = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    address private constant USDE = 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34;
    address private constant USDE_USDG_ORACLE = 0xE64849bd4AD03DfaBbe02bb521de19997a19055f;
    address private constant ADAPTIVE_CURVE_IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;
    uint256 private constant LLTV = 915_000_000_000_000_000;
    bytes32 private constant EXPECTED_MARKET_ID = 0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6;
    address private constant EZ_WRAPPER = 0x6F81790Ebac25497be379Dc66143fb298663Ae11;
    address private constant EZ_UNISWAP_ADAPTER = 0xbcAb6Cc4b2F1990F8e6e9f11C881a229D69CBb27;
    address private constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant WETH_USDG_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    uint128 private constant STABLE_DEPOSIT_CAP = 10_000e6;
    uint128 private constant RANGE_DEPOSIT_CAP = 1 ether;
    uint128 private constant LAUNCH_DEPOSIT_CAP = 0.25 ether;
    uint128 private constant MIN_MARKET_SUPPLY = 10_000_000e6;
    uint16 private constant MAX_UTILIZATION_BPS = 9_500;

    function run() external {
        require(block.chainid == ROBINHOOD_MAINNET_CHAIN_ID, "wrong chain");
        require(
            USDG.code.length != 0 && WETH.code.length != 0 && MORPHO.code.length != 0 && EZ_WRAPPER.code.length != 0
                && SWAP_ROUTER.code.length != 0 && WETH_USDG_POOL.code.length != 0,
            "missing canonical contracts"
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address payable treasury = payable(vm.envOr("TREASURY_ADDRESS", deployer));
        require(owner != address(0) && treasury != address(0), "zero control address");

        MarketParams memory stableMarket = MarketParams({
            loanToken: USDG, collateralToken: USDE, oracle: USDE_USDG_ORACLE, irm: ADAPTIVE_CURVE_IRM, lltv: LLTV
        });
        Id stableMarketId = stableMarket.id();
        require(Id.unwrap(stableMarketId) == EXPECTED_MARKET_ID, "market id mismatch");
        require(IMorpho(MORPHO).market(stableMarketId).lastUpdate != 0, "market missing");

        uint256 deploymentBlock = block.number;
        vm.startBroadcast(deployerKey);
        MorphoBlueAdapter stableAdapter =
            new MorphoBlueAdapter(IMorpho(MORPHO), stableMarket, MIN_MARKET_SUPPLY, MAX_UTILIZATION_BPS);
        EZManagerRangeAdapter rangeAdapter = new EZManagerRangeAdapter(
            IERC20(WETH),
            IEZWrapper(EZ_WRAPPER),
            ISwapRouter02(SWAP_ROUTER),
            IUniswapV3PoolLike(WETH_USDG_POOL),
            EZ_UNISWAP_ADAPTER,
            1_200,
            300,
            1e6
        );
        LaunchReserveAdapter launchReserveAdapter = new LaunchReserveAdapter(IERC20(WETH));
        PolicyExecutor policy = new PolicyExecutor(deployer);
        KeyMarketplace market = new KeyMarketplace(deployer, treasury, 300);
        LiquidMuppetsFactory factory = new LiquidMuppetsFactory(deployer, policy, market);
        policy.setFactory(address(factory));
        market.setFactory(address(factory));
        factory.setTaskConfig(
            0,
            LiquidMuppetsFactory.TaskConfig({
                asset: IERC20(USDG),
                adapter: stableAdapter,
                sharePrefix: "mUSDG",
                maxSingleBps: 9_000,
                maxDailyBps: 9_000,
                maxAllocationBps: 9_000,
                cooldownSeconds: 30 minutes,
                depositCap: STABLE_DEPOSIT_CAP,
                enabled: true
            })
        );
        factory.setTaskConfig(
            1,
            LiquidMuppetsFactory.TaskConfig({
                asset: IERC20(WETH),
                adapter: rangeAdapter,
                sharePrefix: "mETH",
                maxSingleBps: 8_500,
                maxDailyBps: 8_500,
                maxAllocationBps: 8_500,
                cooldownSeconds: 6 hours,
                depositCap: RANGE_DEPOSIT_CAP,
                enabled: true
            })
        );
        factory.setTaskConfig(
            2,
            LiquidMuppetsFactory.TaskConfig({
                asset: IERC20(WETH),
                adapter: launchReserveAdapter,
                sharePrefix: "mLAUNCH",
                maxSingleBps: 1_000,
                maxDailyBps: 1_000,
                maxAllocationBps: 1_000,
                cooldownSeconds: 30 minutes,
                depositCap: LAUNCH_DEPOSIT_CAP,
                enabled: true
            })
        );
        if (owner != deployer) {
            policy.transferOwnership(owner);
            market.transferOwnership(owner);
            factory.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("owner", owner);
        console2.log("treasury", treasury);
        console2.log("factory", address(factory));
        console2.log("policyExecutor", address(policy));
        console2.log("keyMarketplace", address(market));
        console2.log("stableAdapter", address(stableAdapter));
        console2.log("rangeAdapter", address(rangeAdapter));
        console2.log("launchReserveAdapter", address(launchReserveAdapter));
        console2.log("USDG", USDG);
        console2.logBytes32(EXPECTED_MARKET_ID);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", deploymentBlock);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "owner", owner);
        vm.serializeAddress(root, "treasury", treasury);
        vm.serializeAddress(root, "factory", address(factory));
        vm.serializeAddress(root, "policyExecutor", address(policy));
        vm.serializeAddress(root, "keyMarketplace", address(market));
        vm.serializeAddress(root, "USDG", USDG);
        vm.serializeAddress(root, "morpho", MORPHO);
        vm.serializeBytes32(root, "stableMarketId", EXPECTED_MARKET_ID);
        vm.serializeUint(root, "stableDepositCap", STABLE_DEPOSIT_CAP);
        vm.serializeUint(root, "rangeDepositCap", RANGE_DEPOSIT_CAP);
        vm.serializeUint(root, "launchDepositCap", LAUNCH_DEPOSIT_CAP);
        vm.serializeAddress(root, "stableAdapter", address(stableAdapter));
        vm.serializeAddress(root, "rangeAdapter", address(rangeAdapter));
        vm.serializeAddress(root, "launchReserveAdapter", address(launchReserveAdapter));
        vm.serializeAddress(root, "WETH", WETH);
        vm.serializeAddress(root, "ezWrapper", EZ_WRAPPER);
        vm.serializeAddress(root, "swapRouter", SWAP_ROUTER);
        string memory json = vm.serializeAddress(root, "wethUsdgPool", WETH_USDG_POOL);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/robinhood-mainnet.json"));
    }
}
