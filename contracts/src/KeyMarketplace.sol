// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Escrowed asks and bids for whole-unit Agent Keys.
contract KeyMarketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint16 public feeBps;
    address payable public treasury;
    address public factory;
    uint256 public nextListingId = 1;
    uint256 public nextOfferId = 1;

    struct Listing {
        address seller;
        IERC20 key;
        uint128 quantity;
        uint128 unitPriceWei;
        bool active;
    }

    struct Offer {
        address buyer;
        IERC20 key;
        uint128 quantity;
        uint128 unitPriceWei;
        uint256 escrowWei;
        bool active;
    }

    mapping(uint256 id => Listing listing) public listings;
    mapping(uint256 id => Offer offer) public offers;
    mapping(uint256 id => uint16 feeBpsAtCreation) public offerFeeBps;
    mapping(address key => bool approved) public approvedKeys;

    event FactorySet(address indexed factory);
    event AgentKeyRegistered(address indexed key);
    event ListingCreated(
        uint256 indexed id, address indexed key, address indexed seller, uint256 quantity, uint256 unitPriceWei
    );
    event ListingFilled(
        uint256 indexed id, address indexed buyer, uint256 quantity, uint256 subtotalWei, uint256 feeWei
    );
    event ListingCancelled(uint256 indexed id);
    event OfferCreated(
        uint256 indexed id, address indexed key, address indexed buyer, uint256 quantity, uint256 unitPriceWei
    );
    event OfferFilled(
        uint256 indexed id, address indexed seller, uint256 quantity, uint256 subtotalWei, uint256 feeWei
    );
    event OfferCancelled(uint256 indexed id);

    error InvalidKey();
    error InvalidOrder();
    error InactiveOrder();
    error NotOrderOwner();
    error IncorrectPayment();
    error PaymentFailed();
    error FeeTooHigh();
    error OnlyFactory();
    error FactoryAlreadySet();

    constructor(address initialOwner, address payable treasury_, uint16 feeBps_) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert InvalidOrder();
        if (feeBps_ > 1_000) revert FeeTooHigh();
        treasury = treasury_;
        feeBps = feeBps_;
    }

    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_ == address(0)) revert InvalidOrder();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function registerKey(IERC20 key) external {
        if (msg.sender != factory) revert OnlyFactory();
        _checkKeyShape(key);
        approvedKeys[address(key)] = true;
        emit AgentKeyRegistered(address(key));
    }

    function createListing(IERC20 key, uint128 quantity, uint128 unitPriceWei)
        external
        nonReentrant
        returns (uint256 id)
    {
        _checkKey(key);
        if (quantity == 0 || unitPriceWei == 0) revert InvalidOrder();
        key.safeTransferFrom(msg.sender, address(this), quantity);
        id = nextListingId++;
        listings[id] = Listing(msg.sender, key, quantity, unitPriceWei, true);
        emit ListingCreated(id, address(key), msg.sender, quantity, unitPriceWei);
    }

    function cancelListing(uint256 id) external nonReentrant {
        Listing storage listing = listings[id];
        if (!listing.active) revert InactiveOrder();
        if (listing.seller != msg.sender) revert NotOrderOwner();
        listing.active = false;
        uint256 quantity = listing.quantity;
        listing.quantity = 0;
        listing.key.safeTransfer(listing.seller, quantity);
        emit ListingCancelled(id);
    }

    function buy(uint256 id, uint128 quantity) external payable nonReentrant {
        Listing storage listing = listings[id];
        if (!listing.active || quantity == 0 || quantity > listing.quantity) revert InactiveOrder();
        uint256 subtotal = uint256(quantity) * listing.unitPriceWei;
        uint256 fee = subtotal * feeBps / BPS;
        if (msg.value != subtotal + fee) revert IncorrectPayment();

        listing.quantity -= quantity;
        if (listing.quantity == 0) listing.active = false;
        listing.key.safeTransfer(msg.sender, quantity);
        _pay(payable(listing.seller), subtotal);
        _pay(treasury, fee);
        emit ListingFilled(id, msg.sender, quantity, subtotal, fee);
    }

    function createOffer(IERC20 key, uint128 quantity, uint128 unitPriceWei)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        _checkKey(key);
        if (quantity == 0 || unitPriceWei == 0) revert InvalidOrder();
        uint256 subtotal = uint256(quantity) * unitPriceWei;
        uint256 fee = subtotal * feeBps / BPS;
        if (msg.value != subtotal + fee) revert IncorrectPayment();
        id = nextOfferId++;
        offers[id] = Offer(msg.sender, key, quantity, unitPriceWei, msg.value, true);
        offerFeeBps[id] = feeBps;
        emit OfferCreated(id, address(key), msg.sender, quantity, unitPriceWei);
    }

    function cancelOffer(uint256 id) external nonReentrant {
        Offer storage offer = offers[id];
        if (!offer.active) revert InactiveOrder();
        if (offer.buyer != msg.sender) revert NotOrderOwner();
        offer.active = false;
        uint256 refund = offer.escrowWei;
        offer.escrowWei = 0;
        _pay(payable(offer.buyer), refund);
        emit OfferCancelled(id);
    }

    function acceptOffer(uint256 id, uint128 quantity) external nonReentrant {
        Offer storage offer = offers[id];
        if (!offer.active || quantity == 0 || quantity > offer.quantity) revert InactiveOrder();
        uint256 subtotal = uint256(quantity) * offer.unitPriceWei;
        uint256 fee = subtotal * offerFeeBps[id] / BPS;

        offer.key.safeTransferFrom(msg.sender, offer.buyer, quantity);
        offer.quantity -= quantity;
        offer.escrowWei -= subtotal + fee;
        uint256 refund;
        if (offer.quantity == 0) {
            offer.active = false;
            refund = offer.escrowWei;
            offer.escrowWei = 0;
        }
        _pay(payable(msg.sender), subtotal);
        _pay(treasury, fee);
        _pay(payable(offer.buyer), refund);
        emit OfferFilled(id, msg.sender, quantity, subtotal, fee);
    }

    function setFee(uint16 nextFeeBps) external onlyOwner {
        if (nextFeeBps > 1_000) revert FeeTooHigh();
        feeBps = nextFeeBps;
    }

    function setTreasury(address payable nextTreasury) external onlyOwner {
        if (nextTreasury == address(0)) revert InvalidOrder();
        treasury = nextTreasury;
    }

    function _checkKey(IERC20 key) internal view {
        if (!approvedKeys[address(key)]) revert InvalidKey();
        _checkKeyShape(key);
    }

    function _checkKeyShape(IERC20 key) internal view {
        if (address(key).code.length == 0 || IERC20Metadata(address(key)).decimals() != 0) revert InvalidKey();
    }

    function _pay(address payable receiver, uint256 value) internal {
        if (value == 0) return;
        (bool ok,) = receiver.call{value: value}("");
        if (!ok) revert PaymentFailed();
    }
}
