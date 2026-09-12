// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MuppetStockDrops} from "../src/MuppetStockDrops.sol";

contract StockDropToken is ERC20 {
    bool public tax;
    bool public blocked;
    address public callback;
    bytes public callbackData;
    bool public callbackSucceeded;

    constructor() ERC20("Stock Token", "STOCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function seize(address from, uint256 amount) external { _burn(from, amount); }
    function configure(bool taxed, bool frozen) external { tax = taxed; blocked = frozen; }
    function setCallback(address target, bytes memory data) external { callback = target; callbackData = data; }
    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked, "issuer blocked transfer");
        if (callback != address(0) && from != address(0)) {
            (callbackSucceeded,) = callback.call(callbackData);
        }
        if (tax && from != address(0) && to != address(0)) {
            super._update(from, address(0), amount / 100);
            super._update(from, to, amount - amount / 100);
        } else {
            super._update(from, to, amount);
        }
    }
}

contract MuppetStockDropsTest is Test {
    MuppetStockDrops internal drops;
    StockDropToken internal muppets;
    StockDropToken internal stock;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    bytes32 internal snapshotHash = keccak256("historical snapshot");
    bytes32 internal manifestHash = keccak256("published allocations");

    function setUp() public {
        vm.roll(1000);
        muppets = new StockDropToken();
        stock = new StockDropToken();
        address[] memory tokens = new address[](1);
        tokens[0] = address(stock);
        drops = new MuppetStockDrops(address(this), address(muppets), tokens);
        stock.mint(address(this), 1_000 ether);
        stock.approve(address(drops), type(uint256).max);
    }

    function leaf(uint256 id, uint256 index, address account, uint256 amount) internal view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(drops), id, index, account, amount))));
    }
    function fund(uint256 id, uint256 budget, bytes32 root) internal {
        drops.fundDrop(id, address(stock), budget, 100, snapshotHash, root, manifestHash);
    }
    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function testFullyFundedClaimPaysRecipientWithoutMuppetsOrApproval() public {
        fund(0, 7 ether, leaf(0, 0, alice, 7 ether));
        assertEq(stock.balanceOf(address(drops)), 7 ether);
        assertEq(drops.liability(address(stock)), 7 ether);
        vm.prank(bob); // Relaying cannot redirect the funds.
        drops.claim(0, 0, alice, 7 ether, new bytes32[](0));
        assertEq(stock.balanceOf(alice), 7 ether);
        assertEq(stock.balanceOf(bob), 0);
        assertEq(muppets.balanceOf(alice), 0);
        assertEq(drops.liability(address(stock)), 0);
        assertTrue(drops.isClaimed(0, 0));
    }

    function testClaimsDoNotExpireOrDependOnPublisher() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        drops.renounceOwnership();
        vm.warp(block.timestamp + 10 * 365 days);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        assertEq(stock.balanceOf(alice), 1 ether);
    }

    function testMultipleRecipientsAndBitmapBoundary() public {
        bytes32 a = leaf(0, 255, alice, 3 ether);
        bytes32 b = leaf(0, 256, bob, 4 ether);
        fund(0, 7 ether, pair(a, b));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = a;
        drops.claim(0, 256, bob, 4 ether, proof);
        proof[0] = b;
        drops.claim(0, 255, alice, 3 ether, proof);
        assertTrue(drops.isClaimed(0, 255));
        assertTrue(drops.isClaimed(0, 256));
        assertFalse(drops.isClaimed(0, 254));
        assertEq(stock.balanceOf(address(drops)), 0);
    }

    function testRejectsDoubleClaim() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        vm.expectRevert(MuppetStockDrops.AlreadyClaimed.selector);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
    }

    function testCannotRedirectChangeAmountOrIndex() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        drops.claim(0, 0, bob, 1 ether, new bytes32[](0));
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        drops.claim(0, 0, alice, 2 ether, new bytes32[](0));
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        drops.claim(0, 1, alice, 1 ether, new bytes32[](0));
    }

    function testCannotReplayAcrossDropChainOrContract() public {
        bytes32 root = leaf(0, 0, alice, 1 ether);
        fund(0, 1 ether, root);
        fund(1, 1 ether, root);
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        drops.claim(1, 0, alice, 1 ether, new bytes32[](0));
        vm.chainId(block.chainid + 1);
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        vm.chainId(block.chainid - 1);
        address[] memory tokens = new address[](1);
        tokens[0] = address(stock);
        MuppetStockDrops other = new MuppetStockDrops(address(this), address(muppets), tokens);
        stock.approve(address(other), 1 ether);
        other.fundDrop(0, address(stock), 1 ether, 100, snapshotHash, root, manifestHash);
        vm.expectRevert(MuppetStockDrops.InvalidProof.selector);
        other.claim(0, 0, alice, 1 ether, new bytes32[](0));
    }

    function testCannotUseAnotherDropBudget() public {
        fund(0, 1 ether, leaf(0, 0, alice, 2 ether));
        fund(1, 3 ether, leaf(1, 0, bob, 3 ether));
        vm.expectRevert(MuppetStockDrops.BudgetExceeded.selector);
        drops.claim(0, 0, alice, 2 ether, new bytes32[](0));
        assertEq(drops.liability(address(stock)), 4 ether);
        assertFalse(drops.isClaimed(0, 0));
    }

    function testOnlyOwnerCanPublishAndRootCannotBeReplaced() public {
        bytes32 root = leaf(0, 0, alice, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        drops.fundDrop(0, address(stock), 1 ether, 100, snapshotHash, root, manifestHash);
        fund(0, 1 ether, root);
        vm.expectRevert(MuppetStockDrops.InvalidDrop.selector);
        fund(0, 2 ether, leaf(0, 0, bob, 2 ether));
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
    }

    function testRejectsUnfundedAndTaxedFunding() public {
        stock.approve(address(drops), 0);
        bytes32 root = leaf(0, 0, alice, 1 ether);
        vm.expectRevert();
        fund(0, 1 ether, root);
        stock.approve(address(drops), type(uint256).max);
        stock.configure(true, false);
        vm.expectRevert(MuppetStockDrops.InexactTransfer.selector);
        fund(0, 1 ether, root);
        assertEq(drops.nextDropId(), 0);
        assertEq(drops.liability(address(stock)), 0);
        assertEq(stock.balanceOf(address(drops)), 0);
    }

    function testTransferFailureAndTransferTaxKeepClaimAvailable() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        stock.configure(false, true);
        vm.expectRevert("issuer blocked transfer");
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        stock.configure(true, false);
        vm.expectRevert(MuppetStockDrops.InexactTransfer.selector);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        assertFalse(drops.isClaimed(0, 0));
        assertEq(drops.liability(address(stock)), 1 ether);
        stock.configure(false, false);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
    }

    function testIssuerBalanceReductionCannotConsumeAnotherDropInventory() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        fund(1, 1 ether, leaf(1, 0, bob, 1 ether));
        stock.seize(address(drops), 1 ether);
        vm.expectRevert(MuppetStockDrops.InsolventInventory.selector);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        bytes32 root = leaf(2, 0, alice, 1 ether);
        vm.expectRevert(MuppetStockDrops.InsolventInventory.selector);
        fund(2, 1 ether, root);
        assertFalse(drops.isClaimed(0, 0));
        assertEq(drops.liability(address(stock)), 2 ether);
        // A separately provided top-up can restore the original committed claims.
        stock.transfer(address(drops), 1 ether);
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        drops.claim(1, 0, bob, 1 ether, new bytes32[](0));
        assertEq(drops.liability(address(stock)), 0);
    }

    function testReentrantTokenCannotClaimTwice() public {
        fund(0, 1 ether, leaf(0, 0, alice, 1 ether));
        stock.setCallback(address(drops), abi.encodeCall(drops.claim, (0, 0, alice, 1 ether, new bytes32[](0))));
        drops.claim(0, 0, alice, 1 ether, new bytes32[](0));
        assertFalse(stock.callbackSucceeded());
        assertEq(stock.balanceOf(alice), 1 ether);
    }

    function testRejectsWrongKnownSnapshotFutureSnapshotAndUnknownToken() public {
        bytes32 root = leaf(0, 0, alice, 1 ether);
        vm.setBlockhash(999, snapshotHash);
        vm.expectRevert(MuppetStockDrops.InvalidDrop.selector);
        drops.fundDrop(0, address(stock), 1 ether, 999, keccak256("wrong"), root, manifestHash);
        vm.expectRevert(MuppetStockDrops.InvalidDrop.selector);
        drops.fundDrop(0, address(stock), 1 ether, 1000, snapshotHash, root, manifestHash);
        vm.expectRevert(MuppetStockDrops.InvalidToken.selector);
        drops.fundDrop(0, address(muppets), 1 ether, 100, snapshotHash, root, manifestHash);
    }

    function testFuzzBudgetConservation(uint96 first, uint96 second) public {
        uint256 a = bound(uint256(first), 1, 100 ether);
        uint256 b = bound(uint256(second), 1, 100 ether);
        fund(0, a, leaf(0, 0, alice, a));
        fund(1, b, leaf(1, 0, alice, b));
        drops.claim(1, 0, alice, b, new bytes32[](0));
        assertEq(stock.balanceOf(address(drops)), a);
        assertEq(drops.liability(address(stock)), a);
        drops.claim(0, 0, alice, a, new bytes32[](0));
        assertEq(stock.balanceOf(alice), a + b);
        assertEq(drops.liability(address(stock)), 0);
    }
}
