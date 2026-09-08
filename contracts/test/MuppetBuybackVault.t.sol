// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IMuppetsBuybackExecutor, MuppetBuybackVault} from "../src/MuppetBuybackVault.sol";

contract MockMuppetsBuybackExecutor {
    MockERC20 public immutable MUPPETS;

    constructor(MockERC20 muppets) {
        MUPPETS = muppets;
    }

    function executeBuy(uint256 minimumOutput, uint256, address recipient)
        external
        payable
        returns (uint256 amountOut)
    {
        require(msg.value != 0 && minimumOutput != 0, "invalid buy");
        amountOut = minimumOutput + 1 ether;
        MUPPETS.mint(recipient, amountOut);
    }
}

contract BuybackGovernanceHarness {
    receive() external payable {}

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool ok, bytes memory response) = target.call(data);
        require(ok, "governance call failed");
        return response;
    }
}

contract MuppetBuybackVaultTest is Test {
    MockERC20 internal muppets;
    MockMuppetsBuybackExecutor internal executor;
    MuppetBuybackVault internal vault;
    BuybackGovernanceHarness internal governance;

    address internal keeper = makeAddr("buyback-keeper");
    address internal key = makeAddr("agent-key");

    function setUp() public {
        muppets = new MockERC20("Muppets", "MUPPETS", 18, 0);
        executor = new MockMuppetsBuybackExecutor(muppets);
        governance = new BuybackGovernanceHarness();
        vault = new MuppetBuybackVault(
            address(this), IMuppetsBuybackExecutor(address(executor)), address(governance), 0.01 ether, 30 minutes
        );
        vault.setRevenueRouter(address(governance));
        vault.setKeeper(keeper, true);
        vault.transferOwnership(address(governance));
        governance.execute(address(vault), abi.encodeCall(MuppetBuybackVault.activate, ()));
        vm.deal(address(governance), 2 ether);
    }

    function testKeyBudgetBuysAndVestsMuppetsForFiveYears() public {
        vm.prank(address(governance));
        vault.fundKey{value: 0.005 ether}(key);

        vm.prank(keeper);
        uint256 purchased = vault.executeKeyBuyback(key, 0.005 ether, 99 ether, block.timestamp + 1 minutes);
        assertEq(purchased, 100 ether);
        assertEq(vault.pendingNativeByKey(key), 0);
        assertEq(vault.totalSpentByKey(key), 0.005 ether);
        assertEq(vault.totalMuppetsPurchasedByKey(key), 100 ether);
        assertEq(vault.releasableMuppets(0, 1), 0);

        vm.warp(block.timestamp + vault.VESTING_DURATION() / 2);
        uint256 expected = 50 ether;
        assertEq(vault.releasableMuppets(0, 1), expected);
        vault.releaseMuppets(0, 1);
        assertEq(muppets.balanceOf(address(governance)), expected);

        vm.warp(block.timestamp + vault.VESTING_DURATION());
        vault.releaseMuppets(0, 1);
        assertEq(muppets.balanceOf(address(governance)), 100 ether);
    }

    function testOnlyConfiguredKeeperCanSpendAttributedBudget() public {
        vm.prank(address(governance));
        vault.fundKey{value: 0.005 ether}(key);

        vm.expectRevert(MuppetBuybackVault.NotKeeper.selector);
        vault.executeKeyBuyback(key, 0.005 ether, 99 ether, block.timestamp + 1 minutes);

        vm.prank(keeper);
        vm.expectRevert(MuppetBuybackVault.InvalidAmount.selector);
        vault.executeKeyBuyback(key, 0.011 ether, 99 ether, block.timestamp + 1 minutes);
    }
}
