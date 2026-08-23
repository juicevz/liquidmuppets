// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";

/// @notice Single-asset vault whose policy executor can move idle assets into one reviewed adapter.
contract StrategyVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable policyExecutor;
    IStrategyAdapter public immutable adapter;
    uint8 public immutable taskId;
    uint256 public immutable depositCap;
    uint8 private immutable shareDecimalsOffset;

    event AssetsAllocated(uint256 assets);
    event AssetsRecalled(uint256 assets);

    error OnlyPolicyExecutor();
    error InvalidAdapterAsset();
    error InvalidDepositCap();
    error InsufficientIdleAssets();

    modifier onlyPolicyExecutor() {
        if (msg.sender != policyExecutor) revert OnlyPolicyExecutor();
        _;
    }

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address policyExecutor_,
        IStrategyAdapter adapter_,
        uint8 taskId_,
        uint256 depositCap_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (adapter_.asset() != address(asset_)) revert InvalidAdapterAsset();
        if (policyExecutor_ == address(0) || depositCap_ == 0) revert InvalidDepositCap();
        policyExecutor = policyExecutor_;
        adapter = adapter_;
        taskId = taskId_;
        depositCap = depositCap_;
        uint8 assetDecimals = IERC20Metadata(address(asset_)).decimals();
        shareDecimalsOffset = assetDecimals < 18 ? 18 - assetDecimals : 0;
        asset_.forceApprove(address(adapter_), type(uint256).max);
    }

    function maxDeposit(address) public view override returns (uint256) {
        uint256 assets = totalAssets();
        return assets >= depositCap ? 0 : depositCap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function totalAssets() public view override returns (uint256) {
        return idleAssets() + deployedAssets();
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function deployedAssets() public view returns (uint256) {
        return adapter.totalAssetsFor(address(this));
    }

    function allocateToAdapter(uint256 assets) external onlyPolicyExecutor {
        if (assets > idleAssets()) revert InsufficientIdleAssets();
        adapter.deposit(assets);
        emit AssetsAllocated(assets);
    }

    function recallFromAdapter(uint256 assets) external onlyPolicyExecutor {
        adapter.withdraw(assets);
        emit AssetsRecalled(assets);
    }

    /// @dev A full redemption transfers the adapter's realized output rather than leaving execution dust behind.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        if (shares != totalSupply()) return super.redeem(shares, receiver, owner);

        address caller = _msgSender();
        if (caller != owner) _spendAllowance(owner, caller, shares);
        uint256 deployed = deployedAssets();
        if (deployed != 0) {
            adapter.withdraw(deployed);
            emit AssetsRecalled(deployed);
        }
        assets = idleAssets();
        _burn(owner, shares);
        _transferOut(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (shares == totalSupply()) {
            uint256 deployed = deployedAssets();
            if (deployed != 0) {
                adapter.withdraw(deployed);
                emit AssetsRecalled(deployed);
            }
        } else {
            uint256 idle = idleAssets();
            if (idle < assets) {
                uint256 missing = assets - idle;
                adapter.withdraw(missing);
                emit AssetsRecalled(missing);
            }
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _decimalsOffset() internal view override returns (uint8) {
        return shareDecimalsOffset;
    }
}
