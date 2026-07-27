// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A fixed-supply, whole-unit access token for one strategy.
/// @dev It is intentionally separate from the vault share token and has no claim on vault assets.
contract AgentKey is ERC20 {
    mapping(address holder => uint256 quantity) public boundBalance;
    uint256 public totalBound;

    event KeyBound(address indexed holder, uint256 quantity);

    error InvalidSupply();
    error InvalidQuantity();

    constructor(string memory name_, string memory symbol_, address creator_, uint256 supply_) ERC20(name_, symbol_) {
        if (supply_ == 0 || supply_ > 100_000) revert InvalidSupply();
        _mint(creator_, supply_);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function bind(uint256 quantity) external {
        if (quantity == 0) revert InvalidQuantity();
        _burn(msg.sender, quantity);
        boundBalance[msg.sender] += quantity;
        totalBound += quantity;
        emit KeyBound(msg.sender, quantity);
    }
}

