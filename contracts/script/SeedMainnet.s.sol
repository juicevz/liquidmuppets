// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LiquidMuppetsFactory} from "../src/LiquidMuppetsFactory.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {AgentKey} from "../src/AgentKey.sol";
import {IEZValuation, ISwapRouter02} from "../src/interfaces/IEZManager.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
}

/// @notice Creates three explicitly named developer fixtures and exercises each money route with tiny amounts.
contract SeedMainnet is Script {
    uint256 private constant CHAIN_ID = 4663;
    LiquidMuppetsFactory private constant FACTORY = LiquidMuppetsFactory(0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460);
    PolicyExecutor private constant POLICY = PolicyExecutor(0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc);
    KeyMarketplace private constant MARKET = KeyMarketplace(payable(0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb));
    IWETH private constant WETH = IWETH(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    ISwapRouter02 private constant ROUTER = ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);
    IEZValuation private constant VALUATION = IEZValuation(0x3A5e783c9E7B24505d0baee021D555e81EA86E79);
    address private constant EZ_UNISWAP_ADAPTER = 0xbcAb6Cc4b2F1990F8e6e9f11C881a229D69CBb27;

    struct Fixture {
        uint256 id;
        StrategyVault vault;
        AgentKey key;
    }

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        require(FACTORY.agentCount() == 0, "fixtures already exist");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(FACTORY.owner() == deployer && POLICY.owner() == deployer, "wrong signer");

        vm.startBroadcast(deployerKey);
        WETH.deposit{value: 0.011 ether}();

        Fixture memory stable = _launch(5, 0, "morpho frog", "MFROG");
        Fixture memory range = _launch(3, 1, "range fox", "RFOX");
        Fixture memory launch = _launch(1, 2, "launch sage", "LSAGE");

        uint256 usdgAmount = _swapForUsdg(0.002 ether, deployer);
        USDG.approve(address(stable.vault), usdgAmount);
        stable.vault.deposit(usdgAmount, deployer);
        POLICY.executeAllocate(address(stable.vault), Math.mulDiv(usdgAmount, 9_000, 10_000));

        WETH.approve(address(range.vault), 0.006 ether);
        range.vault.deposit(0.006 ether, deployer);
        POLICY.executeAllocate(address(range.vault), 0.0051 ether);

        WETH.approve(address(launch.vault), 0.003 ether);
        launch.vault.deposit(0.003 ether, deployer);
        POLICY.executeAllocate(address(launch.vault), 0.0003 ether);
        vm.stopBroadcast();

        console2.log("stableAgent", stable.id);
        console2.log("stableVault", address(stable.vault));
        console2.log("rangeAgent", range.id);
        console2.log("rangeVault", address(range.vault));
        console2.log("launchAgent", launch.id);
        console2.log("launchVault", address(launch.vault));
        console2.log("seededUsdg", usdgAmount);
    }

    function _launch(uint8 petId, uint8 taskId, string memory name, string memory symbol)
        private
        returns (Fixture memory fixture)
    {
        (uint256 id, address vault, address key) = FACTORY.createAgent(petId, taskId, name, symbol, 100, 0.001 ether);
        AgentKey agentKey = AgentKey(key);
        agentKey.approve(address(MARKET), 20);
        MARKET.createListing(agentKey, 20, 0.001 ether);
        agentKey.bind(1);
        return Fixture(id, StrategyVault(vault), agentKey);
    }

    function _swapForUsdg(uint256 amount, address recipient) private returns (uint256 output) {
        WETH.approve(address(ROUTER), amount);
        uint256 expected = VALUATION.usdcValue(EZ_UNISWAP_ADAPTER, address(WETH), amount);
        output = ROUTER.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(WETH),
                tokenOut: address(USDG),
                fee: 100,
                recipient: recipient,
                amountIn: amount,
                amountOutMinimum: Math.mulDiv(expected, 9_700, 10_000),
                sqrtPriceLimitX96: 0
            })
        );
    }
}
