// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable tokenDecimals;
    uint256 public immutable faucetAmount;
    mapping(address account => uint40 lastClaimAt) public lastClaimAt;

    error FaucetCooldown();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
    {
        tokenDecimals = decimals_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function faucet() external {
        if (lastClaimAt[msg.sender] != 0 && block.timestamp < lastClaimAt[msg.sender] + 1 hours) {
            revert FaucetCooldown();
        }
        lastClaimAt[msg.sender] = uint40(block.timestamp);
        _mint(msg.sender, faucetAmount);
    }

    function mint(address receiver, uint256 amount) external {
        _mint(receiver, amount);
    }
}

