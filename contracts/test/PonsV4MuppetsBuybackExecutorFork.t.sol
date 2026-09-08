// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniversalRouter, PonsV4MuppetsBuybackExecutor} from "../src/PonsV4MuppetsBuybackExecutor.sol";

contract PonsV4MuppetsBuybackExecutorForkTest is Test {
    IERC20 private constant MUPPETS = IERC20(0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189);
    IUniversalRouter private constant UNIVERSAL_ROUTER = IUniversalRouter(0x8876789976dEcBfCbBbe364623C63652db8C0904);
    address private constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;

    function testForkBuysMuppetsThroughGraduatedPonsPool() public {
        if (block.chainid != 4663) return;
        PonsV4MuppetsBuybackExecutor executor =
            new PonsV4MuppetsBuybackExecutor(MUPPETS, UNIVERSAL_ROUTER, PONS_HOOK, 200);
        vm.deal(address(this), 1 ether);

        uint256 beforeBalance = MUPPETS.balanceOf(address(this));
        uint256 received = executor.executeBuy{value: 0.0001 ether}(1, block.timestamp + 1 minutes, address(this));

        assertGt(received, 1);
        assertEq(MUPPETS.balanceOf(address(this)) - beforeBalance, received);
        assertEq(address(executor).balance, 0);
        assertEq(MUPPETS.balanceOf(address(executor)), 0);
    }
}
