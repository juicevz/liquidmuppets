// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fully funded, immutable stock-token allocations. No holder deposits or approvals.
/// @dev The publisher attests historical holder eligibility in a public manifest. The contract
/// verifies the committed allocation, not historical MUPPETS balances. Only non-rebasing,
/// exact-transfer ERC20s belong in the immutable allowlist. Issuer transfer restrictions still apply.
contract MuppetStockDrops is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant VERSION = 1;
    uint256 public constant UNIT = 15_000 ether;
    address public immutable MUPPETS;

    struct Drop {
        address token;
        uint256 funded;
        uint256 claimed;
        uint256 snapshotBlock;
        bytes32 snapshotHash;
        bytes32 root;
        bytes32 manifestHash;
    }

    uint256 public nextDropId;
    mapping(address token => bool) public allowedToken;
    mapping(uint256 dropId => Drop) public drops;
    mapping(address token => uint256) public liability;
    mapping(uint256 dropId => mapping(uint256 word => uint256 bitmap)) private claimedWords;

    error InvalidDrop();
    error InvalidToken();
    error InexactTransfer();
    error AlreadyClaimed();
    error InvalidProof();
    error BudgetExceeded();
    error InsolventInventory();

    event DropFunded(
        uint256 indexed dropId, address indexed token, uint256 amount,
        uint256 snapshotBlock, bytes32 snapshotHash, bytes32 root, bytes32 manifestHash
    );
    event Claimed(uint256 indexed dropId, uint256 indexed index, address indexed account, uint256 amount);

    constructor(address initialOwner, address muppets, address[] memory tokens) Ownable(initialOwner) {
        if (muppets.code.length == 0 || IERC20Metadata(muppets).decimals() != 18) revert InvalidToken();
        if (tokens.length == 0 || tokens.length > 26) revert InvalidToken();
        MUPPETS = muppets;
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            if (token == muppets || token.code.length == 0 || allowedToken[token]) revert InvalidToken();
            if (IERC20Metadata(token).decimals() != 18) revert InvalidToken();
            allowedToken[token] = true;
        }
    }

    /// @notice Pull the whole budget from the publisher and permanently commit this drop.
    /// @dev expectedId prevents signing an allocation for the wrong nonce. Old snapshot hashes
    /// are publisher attestations; when blockhash is available it must agree with the chain.
    function fundDrop(
        uint256 expectedId, address token, uint256 amount, uint256 snapshotBlock,
        bytes32 snapshotHash, bytes32 root, bytes32 manifestHash
    ) external onlyOwner nonReentrant {
        if (!allowedToken[token]) revert InvalidToken();
        if (
            expectedId != nextDropId || amount == 0 || snapshotBlock == 0 || snapshotBlock >= block.number
                || snapshotHash == bytes32(0) || root == bytes32(0) || manifestHash == bytes32(0)
        ) revert InvalidDrop();
        bytes32 knownHash = blockhash(snapshotBlock);
        if (knownHash != bytes32(0) && knownHash != snapshotHash) revert InvalidDrop();
        IERC20 asset = IERC20(token);
        uint256 beforeBalance = asset.balanceOf(address(this));
        if (beforeBalance < liability[token]) revert InsolventInventory();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert InexactTransfer();
        drops[expectedId] = Drop(token, amount, 0, snapshotBlock, snapshotHash, root, manifestHash);
        liability[token] += amount;
        nextDropId = expectedId + 1;
        emit DropFunded(expectedId, token, amount, snapshotBlock, snapshotHash, root, manifestHash);
    }

    function isClaimed(uint256 dropId, uint256 index) public view returns (bool) {
        return claimedWords[dropId][index >> 8] & (1 << (index & 255)) != 0;
    }

    /// @notice Anyone may relay a claim, but stock tokens can only go to the committed recipient.
    function claim(uint256 dropId, uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external nonReentrant
    {
        Drop storage drop = drops[dropId];
        if (drop.token == address(0) || account == address(0) || account == address(this) || amount == 0) {
            revert InvalidDrop();
        }
        if (isClaimed(dropId, index)) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), dropId, index, account, amount))));
        if (!MerkleProof.verifyCalldata(proof, drop.root, leaf)) revert InvalidProof();
        if (amount > drop.funded - drop.claimed) revert BudgetExceeded();
        claimedWords[dropId][index >> 8] |= 1 << (index & 255);
        drop.claimed += amount;
        liability[drop.token] -= amount;
        IERC20 asset = IERC20(drop.token);
        uint256 beforeVault = asset.balanceOf(address(this));
        // An issuer-side balance reduction must not let earlier claims spend other drops' funding.
        if (beforeVault < liability[drop.token] + amount) revert InsolventInventory();
        uint256 beforeRecipient = asset.balanceOf(account);
        asset.safeTransfer(account, amount);
        if (asset.balanceOf(address(this)) != beforeVault - amount || asset.balanceOf(account) != beforeRecipient + amount) {
            revert InexactTransfer();
        }
        emit Claimed(dropId, index, account, amount);
    }

    // No expiry, root replacement, pause, arbitrary calls, upgrade path, or withdrawal function.
    // Committed inventory remains available for its original recipients, including after ownership changes.
}
