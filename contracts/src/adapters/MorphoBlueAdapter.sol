// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Id, IMorpho, Market, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IOracle} from "morpho-blue/src/interfaces/IOracle.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";
import {SharesMathLib} from "morpho-blue/src/libraries/SharesMathLib.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @notice Supplies one asset to one immutable Morpho Blue market.
/// @dev Morpho supply shares are tracked per calling vault while the adapter owns the aggregate Morpho position.
contract MorphoBlueAdapter is IStrategyAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;
    using SharesMathLib for uint256;

    IMorpho public immutable morpho;
    IERC20 public immutable underlying;
    Id public immutable marketId;
    uint128 public immutable minMarketSupplyAssets;
    uint16 public immutable maxUtilizationBps;
    MarketParams private marketParams;

    mapping(address vault => uint256 shares) public positionShares;
    uint256 public totalTrackedShares;

    event Deposited(address indexed vault, uint256 assets, uint256 morphoShares);
    event Withdrawn(address indexed vault, uint256 assets, uint256 morphoShares);

    error InvalidAddress();
    error InvalidMarket();
    error InvalidAmount();
    error InsufficientPosition();
    error UnsupportedTokenBehavior();
    error MarketSupplyTooLow();
    error MarketUtilizationTooHigh();
    error OracleUnavailable();

    constructor(
        IMorpho morpho_,
        MarketParams memory marketParams_,
        uint128 minMarketSupplyAssets_,
        uint16 maxUtilizationBps_
    ) {
        if (address(morpho_).code.length == 0 || marketParams_.loanToken.code.length == 0) revert InvalidAddress();
        if (minMarketSupplyAssets_ == 0 || maxUtilizationBps_ == 0 || maxUtilizationBps_ > 10_000) {
            revert InvalidMarket();
        }
        Id id = marketParams_.id();
        Market memory market = morpho_.market(id);
        if (market.lastUpdate == 0) revert InvalidMarket();

        morpho = morpho_;
        underlying = IERC20(marketParams_.loanToken);
        marketId = id;
        minMarketSupplyAssets = minMarketSupplyAssets_;
        maxUtilizationBps = maxUtilizationBps_;
        marketParams = marketParams_;
        IERC20(marketParams_.loanToken).forceApprove(address(morpho_), type(uint256).max);
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function getMarketParams() external view returns (MarketParams memory) {
        return marketParams;
    }

    function totalAssetsFor(address vault) public view returns (uint256) {
        uint256 shares = positionShares[vault];
        if (shares == 0) return 0;
        (uint256 totalSupplyAssets, uint256 totalSupplyShares,,) = morpho.expectedMarketBalances(marketParams);
        return shares.toAssetsDown(totalSupplyAssets, totalSupplyShares);
    }

    function deposit(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        _checkMarketHealth();
        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        if (underlying.balanceOf(address(this)) - balanceBefore != assets) revert UnsupportedTokenBehavior();

        (uint256 supplied, uint256 shares) = morpho.supply(marketParams, assets, 0, address(this), "");
        if (supplied != assets || shares == 0) revert InvalidAmount();
        positionShares[msg.sender] += shares;
        totalTrackedShares += shares;
        emit Deposited(msg.sender, assets, shares);
    }

    function marketHealth()
        external
        view
        returns (uint256 totalSupplyAssets, uint256 totalBorrowAssets, uint256 utilizationBps, uint256 oraclePrice)
    {
        (totalSupplyAssets,, totalBorrowAssets,) = morpho.expectedMarketBalances(marketParams);
        utilizationBps =
            totalSupplyAssets == 0 ? type(uint256).max : Math.mulDiv(totalBorrowAssets, 10_000, totalSupplyAssets);
        oraclePrice = IOracle(marketParams.oracle).price();
    }

    function withdraw(uint256 assets) external nonReentrant {
        if (assets == 0) revert InvalidAmount();
        uint256 ownedShares = positionShares[msg.sender];
        uint256 ownedAssets = totalAssetsFor(msg.sender);
        if (ownedShares == 0 || assets > ownedAssets) revert InsufficientPosition();

        uint256 assetsWithdrawn;
        uint256 sharesWithdrawn;
        if (assets == ownedAssets) {
            (assetsWithdrawn, sharesWithdrawn) =
                morpho.withdraw(marketParams, 0, ownedShares, address(this), msg.sender);
        } else {
            (assetsWithdrawn, sharesWithdrawn) = morpho.withdraw(marketParams, assets, 0, address(this), msg.sender);
        }
        if (assetsWithdrawn < assets || sharesWithdrawn > ownedShares) revert InsufficientPosition();

        positionShares[msg.sender] = ownedShares - sharesWithdrawn;
        totalTrackedShares -= sharesWithdrawn;
        emit Withdrawn(msg.sender, assetsWithdrawn, sharesWithdrawn);
    }

    function _checkMarketHealth() private view {
        (uint256 totalSupplyAssets,, uint256 totalBorrowAssets,) = morpho.expectedMarketBalances(marketParams);
        if (totalSupplyAssets < minMarketSupplyAssets) revert MarketSupplyTooLow();
        if (Math.mulDiv(totalBorrowAssets, 10_000, totalSupplyAssets) > maxUtilizationBps) {
            revert MarketUtilizationTooHigh();
        }
        if (IOracle(marketParams.oracle).price() == 0) revert OracleUnavailable();
    }
}
