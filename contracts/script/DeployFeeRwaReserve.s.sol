// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KeyMarketplace} from "../src/KeyMarketplace.sol";
import {PolicyExecutor} from "../src/PolicyExecutor.sol";
import {FeeRwaReserve, IWrappedNative, IUniswapV3FactoryLike} from "../src/FeeRwaReserve.sol";
import {IEZValuation, ISwapRouter02} from "../src/interfaces/IEZManager.sol";

/// @notice Installs the marketplace fee reserve, its initial route set, and one real bootstrap purchase.
contract DeployFeeRwaReserve is Script {
    uint256 private constant CHAIN_ID = 4663;
    address private constant OWNER = 0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f;
    address private constant KEEPER = 0xA5960A69E57F4EbC924503bC829f1E6670BfBA51;
    KeyMarketplace private constant MARKET = KeyMarketplace(payable(0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb));
    PolicyExecutor private constant POLICY = PolicyExecutor(0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc);
    IWrappedNative private constant WETH = IWrappedNative(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
    IERC20 private constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    ISwapRouter02 private constant ROUTER = ISwapRouter02(0xCaf681a66D020601342297493863E78C959E5cb2);
    IUniswapV3FactoryLike private constant UNISWAP_FACTORY =
        IUniswapV3FactoryLike(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA);
    IEZValuation private constant WETH_VALUATION = IEZValuation(0x3A5e783c9E7B24505d0baee021D555e81EA86E79);
    address private constant WETH_VALUATION_DEX = 0xbcAb6Cc4b2F1990F8e6e9f11C881a229D69CBb27;

    uint256 private constant BOOTSTRAP = 0.01 ether;
    uint256 private constant MINIMUM_CYCLE = 0.0001 ether;
    uint256 private constant MAXIMUM_CYCLE = 0.01 ether;
    uint32 private constant COOLDOWN = 30 minutes;
    uint16 private constant SLIPPAGE_BPS = 300;
    uint32 private constant MAX_ORACLE_AGE = 3 days;

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        require(MARKET.owner() == OWNER, "market owner changed");
        require(MARKET.treasury() == OWNER, "market treasury changed");
        require(POLICY.keepers(KEEPER), "keeper is not authorized");
        require(MARKET.nextOfferId() == 4, "unexpected offer state");

        uint256 ownerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(vm.addr(ownerKey) == OWNER, "wrong signer");

        vm.startBroadcast(ownerKey);
        FeeRwaReserve reserve = new FeeRwaReserve(
            OWNER,
            address(MARKET),
            WETH,
            USDG,
            ROUTER,
            UNISWAP_FACTORY,
            WETH_VALUATION,
            WETH_VALUATION_DEX,
            MINIMUM_CYCLE,
            MAXIMUM_CYCLE,
            COOLDOWN,
            SLIPPAGE_BPS
        );
        reserve.setKeeper(KEEPER, true);
        reserve.setRoutes(_routes());
        MARKET.setTreasury(payable(address(reserve)));
        reserve.fund{value: BOOTSTRAP}();
        (uint256 routeIndex, uint256 usdgSpent, uint256 tokenReceived) = reserve.executeAvailableCycle();
        vm.stopBroadcast();

        console2.log("feeRwaReserve", address(reserve));
        console2.log("keeper", KEEPER);
        console2.log("routeCount", reserve.routeCount());
        console2.log("firstRouteIndex", routeIndex);
        console2.log("firstUsdgSpent", usdgSpent);
        console2.log("firstTokenReceived", tokenReceived);
        console2.log("purchaseCount", reserve.purchaseCount());
        console2.log("marketTreasury", MARKET.treasury());
        console2.log("ownerBalanceAfter", OWNER.balance);
    }

    function _routes() private pure returns (FeeRwaReserve.RouteInput[] memory routes) {
        routes = new FeeRwaReserve.RouteInput[](26);
        routes[0] = _route(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 500); // AAPL
        routes[1] = _route(0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 3000); // AMD
        routes[2] = _route(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 3000); // AMZN
        routes[3] =
            _route(0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA, 0xB4106147E8cce40b7d46124090d373A71b70f87D, 10000); // ASML
        routes[4] = _route(0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4, 0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984, 3000); // BABA
        routes[5] = _route(0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a, 3000); // CRCL
        routes[6] =
            _route(0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd, 0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b, 10000); // DELL
        routes[7] = _route(0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, 500); // GME
        routes[8] = _route(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 500); // GOOGL
        routes[9] = _route(0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, 3000); // INTC
        routes[10] =
            _route(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, 3000); // META
        routes[11] =
            _route(0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E, 3000); // MSFT
        routes[12] =
            _route(0xec262a75e413fAfD0dF80480274532C79D42da09, 0x396118bdFB181e6240E74D243F266B061c0edc3D, 10000); // MSTR
        routes[13] =
            _route(0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 3000); // MU
        routes[14] = _route(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 500); // NVDA
        routes[15] =
            _route(0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c, 3000); // PLTR
        routes[16] = _route(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 500); // QQQ
        routes[17] =
            _route(0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5, 0xa0DF4ee0fFf975306345875E3548Fcc519577A11, 3000); // SGOV
        routes[18] =
            _route(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 0x209b73908e92Ae021826eD79609845451Ecba2ce, 3000); // SLV
        routes[19] =
            _route(0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3, 10000); // SNDK
        routes[20] = _route(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 500); // SPCX
        routes[21] = _route(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 500); // SPY
        routes[22] =
            _route(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 3000); // TSLA
        routes[23] =
            _route(0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F, 10000); // TSM
        routes[24] =
            _route(0xd917B029C761D264c6A312BBbcDA868658eF86a6, 0xA994d3684e8400A6c8078226925779FdeE682DD9, 3000); // USAR
        routes[25] =
            _route(0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344, 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c, 3000); // USO
    }

    function _route(address token, address feed, uint24 poolFee)
        private
        pure
        returns (FeeRwaReserve.RouteInput memory)
    {
        return FeeRwaReserve.RouteInput({
            token: token, feed: feed, poolFee: poolFee, maxOracleAge: MAX_ORACLE_AGE, enabled: true
        });
    }
}
