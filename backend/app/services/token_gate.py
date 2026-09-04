from __future__ import annotations

from typing import Any

from web3 import Web3

from app.config import Settings

ERC20_ACCESS_ABI = [
    {
        "type": "function",
        "name": "decimals",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint8"}],
    },
    {
        "type": "function",
        "name": "balanceOf",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]


def format_token_amount(value: int, decimals: int) -> str:
    if decimals == 0:
        return str(value)
    whole, fraction = divmod(value, 10**decimals)
    if fraction == 0:
        return str(whole)
    return f"{whole}.{str(fraction).rjust(decimals, '0').rstrip('0')}"


class TokenGateService:
    def __init__(self, settings: Settings, web3: Web3):
        self.settings = settings
        self.web3 = web3

    @property
    def configured(self) -> bool:
        return Web3.is_address(self.settings.muppets_token_address.strip())

    def _base(self, wallet: str) -> dict[str, Any]:
        return {
            "wallet": wallet.lower(),
            "feature": "agent_launch",
            "configured": self.configured,
            "eligible": False,
            "tokenAddress": self.settings.muppets_token_address.strip() or None,
            "tokenSymbol": self.settings.muppets_token_symbol,
            "minimum": str(self.settings.muppets_token_minimum),
            "decimals": None,
            "balance": None,
            "balanceRaw": None,
            "minimumRaw": None,
            "reason": "token_not_configured",
            "source": "Robinhood Chain RPC",
        }

    def check(self, wallet: str) -> dict[str, Any]:
        if not Web3.is_address(wallet):
            raise ValueError("invalid wallet address")

        result = self._base(wallet)
        if not self.configured:
            return result

        try:
            token_address = Web3.to_checksum_address(self.settings.muppets_token_address)
            wallet_address = Web3.to_checksum_address(wallet)
            if len(self.web3.eth.get_code(token_address)) == 0:
                raise ValueError("configured token address has no runtime code")
            token = self.web3.eth.contract(address=token_address, abi=ERC20_ACCESS_ABI)
            decimals = int(token.functions.decimals().call())
            if decimals < 0 or decimals > 36:
                raise ValueError("token decimals are outside the supported range")
            balance = int(token.functions.balanceOf(wallet_address).call())
        except Exception:
            result["reason"] = "access_check_unavailable"
            return result

        minimum_raw = self.settings.muppets_token_minimum * 10**decimals
        eligible = balance >= minimum_raw
        result.update(
            {
                "eligible": eligible,
                "decimals": decimals,
                "balance": format_token_amount(balance, decimals),
                "balanceRaw": str(balance),
                "minimumRaw": str(minimum_raw),
                "reason": "eligible" if eligible else "below_minimum",
            }
        )
        return result
