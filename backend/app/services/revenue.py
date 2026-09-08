from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from time import monotonic
from typing import Any

from web3 import Web3

from app.config import Settings

PONS_LAUNCH_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "launches",
        "stateMutability": "view",
        "inputs": [{"name": "poolId", "type": "bytes32"}],
        "outputs": [
            {"name": "registered", "type": "bool"},
            {"name": "graduated", "type": "bool"},
            {"name": "token", "type": "address"},
            {"name": "pairedToken", "type": "address"},
            {"name": "creator", "type": "address"},
            {"name": "creatorFeeRecipient", "type": "address"},
            {"name": "protocolFeeRecipient", "type": "address"},
            {"name": "creatorTaxBps", "type": "uint16"},
            {"name": "protocolFeeShareBps", "type": "uint16"},
            {"name": "buybackBurnBps", "type": "uint16"},
            {"name": "hookFeeBps", "type": "uint16"},
            {"name": "maxInternalPriceImpactBps", "type": "uint16"},
            {"name": "buybackEnabled", "type": "bool"},
        ],
    }
]

ROUTER_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "paused", "stateMutability": "view", "inputs": [], "outputs": [{"type": "bool"}]},
    {
        "type": "function",
        "name": "totalPonsRevenue",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalMarketplaceRevenue",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalLegacyMarketplaceRevenue",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalKeyMarketplaceRevenue",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalKeyMarketplaceVolume",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalFundingReceived",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalRevenueRouted",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalBondRewardsDelivered",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalBuybackRouted",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalStockReserveRouted",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalOperationsRouted",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "pendingBondRewardsNative",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "lastRouteAt",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint40"}],
    },
    {
        "type": "function",
        "name": "keyRevenueState",
        "stateMutability": "view",
        "inputs": [{"name": "key", "type": "address"}],
        "outputs": [
            {
                "name": "account",
                "type": "tuple",
                "components": [
                    {"name": "totalVolume", "type": "uint256"},
                    {"name": "totalRevenue", "type": "uint256"},
                    {"name": "totalRouted", "type": "uint256"},
                    {"name": "totalBondRewardsAllocated", "type": "uint256"},
                    {"name": "totalBondRewardsDelivered", "type": "uint256"},
                    {"name": "totalBuybackRouted", "type": "uint256"},
                    {"name": "totalStockReserveRouted", "type": "uint256"},
                    {"name": "totalOperationsRouted", "type": "uint256"},
                    {"name": "pendingBondRewardsNative", "type": "uint256"},
                    {"name": "lastRouteAt", "type": "uint40"},
                ],
            }
        ],
    },
]

BOND_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "paused", "stateMutability": "view", "inputs": [], "outputs": [{"type": "bool"}]},
    {
        "type": "function",
        "name": "totalRewardUnits",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalBondedMuppets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalRewardsNotified",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalRewardsClaimed",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "bondedBalance",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "rewardUnits",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "pendingTotalReward",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalRewardUnitsByKey",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "latestCompletedEpoch",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint40"}],
    },
    {
        "type": "function",
        "name": "totalRewardWeightAtEpoch",
        "stateMutability": "view",
        "inputs": [{"type": "uint40"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalKeyRewardWeightAtEpoch",
        "stateMutability": "view",
        "inputs": [{"type": "address"}, {"type": "uint40"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "keyRewardPerBaseUnitAtEpoch",
        "stateMutability": "view",
        "inputs": [{"type": "address"}, {"type": "uint40"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalKeyRewardsNotified",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalKeyRewardsClaimed",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "pendingKeyReward",
        "stateMutability": "view",
        "inputs": [{"type": "address"}, {"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "accountPositionCount",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]

BUYBACK_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "paused", "stateMutability": "view", "inputs": [], "outputs": [{"type": "bool"}]},
    {
        "type": "function",
        "name": "totalPendingNative",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalFundedNative",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalSpentNative",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalMuppetsPurchased",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "pendingNativeByKey",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalFundedByKey",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalSpentByKey",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalMuppetsPurchasedByKey",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "lastBuybackAt",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint40"}],
    },
]

EVENT_LABELS = {
    Web3.keccak(text="RevenueReceived(bytes32,address,uint256)").hex(): "revenue received",
    Web3.keccak(text="RevenueRouted(address,uint256,uint256,uint256,uint256)").hex(): "weekly revenue routed",
    Web3.keccak(text="BondRewardsDelivered(uint40,uint256,uint256)").hex(): "epoch WETH rewards delivered",
    Web3.keccak(
        text="Bonded(uint256,address,address,uint256,uint256,uint8,uint256,uint256,uint256,uint256,uint256)"
    ).hex(): "Agent Bond position created",
    Web3.keccak(text="Unbonded(uint256,address,address,uint256,uint256)").hex(): "Agent Bond position withdrawn",
    Web3.keccak(text="PositionRewardsClaimed(uint256,address,address,uint256,uint256)").hex(): (
        "position WETH claimed"
    ),
    Web3.keccak(text="KeyRevenueRecorded(address,address,uint256,uint256)").hex(): "Key fee recorded",
    Web3.keccak(text="KeyRevenueRouted(address,address,uint256,uint256,uint256,uint256,uint256)").hex(): (
        "Key revenue routed"
    ),
    Web3.keccak(text="KeyBondRewardsDelivered(address,uint40,uint256,uint256)").hex(): (
        "Key epoch WETH delivered"
    ),
    Web3.keccak(text="KeyFunded(address,uint256,uint256)").hex(): "Key buyback funded",
    Web3.keccak(text="KeyBuybackExecuted(address,address,uint256,uint256,uint256)").hex(): "MUPPETS buyback executed",
}


class RevenueService:
    def __init__(self, settings: Settings, web3: Web3):
        self.settings = settings
        self.web3 = web3
        self._cache_lock = Lock()
        self._cache: tuple[float, dict[str, object]] | None = None

    def read(self, wallet: str | None = None) -> dict[str, object]:
        public_state = self._read_public_state()
        state = dict(public_state)
        state["wallet"] = self._read_wallet(wallet) if wallet else None
        return state

    def read_key(self, key: str, *, legacy_market: bool = False) -> dict[str, object]:
        if not Web3.is_address(key):
            return {"status": "invalid_key", "key": key, "available": False}
        checksum_key = Web3.to_checksum_address(key)
        if legacy_market:
            return {
                "status": "legacy_global",
                "available": False,
                "key": checksum_key,
                "attribution": "legacy_global",
                "detail": (
                    "This Key trades on the legacy marketplace. Its fee transfer does not include the Key address, "
                    "so revenue stays in the global 50/30/20 lane and is not presented as Key-specific."
                ),
                "split": None,
                "market": {"volume_raw": None, "fee_revenue_raw": None, "routed_raw": None},
                "bond": {
                    "units": None,
                    "eligible_weight_bps": None,
                    "reward_epoch": None,
                    "weth_per_1x_unit_raw": None,
                    "weth_delivered_raw": None,
                },
                "buyback": {"funded_raw": None, "pending_raw": None, "spent_raw": None, "muppets_bought_raw": None},
                "tracking_started_at": None,
                "receipt_status": "legacy_market_has_no_key_attribution",
                "receipts": [],
            }

        router_address = self.settings.revenue_router_address
        bond_address = self.settings.agent_bond_address
        buyback_address = self.settings.buyback_vault_address
        required = (router_address, bond_address, buyback_address)
        if not all(Web3.is_address(address) for address in required):
            return self._pending_key_state(checksum_key, "contracts_not_configured")
        try:
            block = self.web3.eth.block_number
            checksummed = tuple(Web3.to_checksum_address(address) for address in required)
            if any(len(self.web3.eth.get_code(address)) == 0 for address in checksummed):
                return self._pending_key_state(checksum_key, "contracts_not_deployed")
            router = self.web3.eth.contract(address=checksummed[0], abi=ROUTER_ABI)
            bond = self.web3.eth.contract(address=checksummed[1], abi=BOND_ABI)
            buyback = self.web3.eth.contract(address=checksummed[2], abi=BUYBACK_ABI)
            revenue = router.functions.keyRevenueState(checksum_key).call(block_identifier=block)
            reward_epoch = bond.functions.latestCompletedEpoch().call(block_identifier=block)
            units, eligible_weight, weth_per_unit, delivered = (
                bond.functions.totalRewardUnitsByKey(checksum_key).call(block_identifier=block),
                bond.functions.totalKeyRewardWeightAtEpoch(checksum_key, reward_epoch).call(block_identifier=block),
                bond.functions.keyRewardPerBaseUnitAtEpoch(checksum_key, reward_epoch).call(block_identifier=block),
                bond.functions.totalKeyRewardsNotified(checksum_key).call(block_identifier=block),
            )
            funded, pending, spent, purchased, last_buyback = (
                buyback.functions.totalFundedByKey(checksum_key).call(block_identifier=block),
                buyback.functions.pendingNativeByKey(checksum_key).call(block_identifier=block),
                buyback.functions.totalSpentByKey(checksum_key).call(block_identifier=block),
                buyback.functions.totalMuppetsPurchasedByKey(checksum_key).call(block_identifier=block),
                buyback.functions.lastBuybackAt(checksum_key).call(block_identifier=block),
            )
            active = not any(
                contract.functions.paused().call(block_identifier=block) for contract in (router, bond, buyback)
            )
            receipts, tracking_started_at, receipt_status = self._read_key_receipts(checksum_key)
            return {
                "status": "exact_key_live" if active else "activation_pending",
                "available": True,
                "key": checksum_key,
                "attribution": "exact_key_v2",
                "detail": (
                    "Each settled V2 market fee carries this Key address into the public revenue ledger."
                    if active
                    else (
                        "Exact-Key accounting is implemented. Mainnet contracts remain inactive "
                        "pending the release gates."
                    )
                ),
                "split": {
                    "agent_bond_weth": "50%",
                    "muppets_buyback": "25%",
                    "stock_token_reserve": "15%",
                    "operations": "10%",
                },
                "market": {
                    "volume_raw": str(int(revenue[0])),
                    "fee_revenue_raw": str(int(revenue[1])),
                    "routed_raw": str(int(revenue[2])),
                    "last_route_at": int(revenue[9]),
                },
                "bond": {
                    "units": str(int(units)),
                    "eligible_weight_bps": str(int(eligible_weight)),
                    "reward_epoch": int(reward_epoch),
                    "weth_per_1x_unit_raw": str(int(weth_per_unit)),
                    "weth_delivered_raw": str(int(delivered)),
                    "pending_native_raw": str(int(revenue[8])),
                },
                "buyback": {
                    "routed_raw": str(int(revenue[5])),
                    "funded_raw": str(int(funded)),
                    "pending_raw": str(int(pending)),
                    "spent_raw": str(int(spent)),
                    "muppets_bought_raw": str(int(purchased)),
                    "last_buyback_at": int(last_buyback),
                    "vesting": "five years from each purchase",
                },
                "stock_reserve_routed_raw": str(int(revenue[6])),
                "operations_routed_raw": str(int(revenue[7])),
                "block_number": block,
                "tracking_started_at": tracking_started_at,
                "receipt_status": receipt_status,
                "receipts": receipts,
            }
        except Exception as error:
            return self._pending_key_state(checksum_key, f"read_unavailable:{type(error).__name__}")

    def _read_public_state(self) -> dict[str, object]:
        with self._cache_lock:
            now = monotonic()
            if self._cache is not None and self._cache[0] > now:
                return self._cache[1]

            pons = self._read_pons()
            router = self._read_router()
            bond = self._read_bond()
            buyback = self._read_buyback()
            receipts, tracking_started_at, receipt_status = self._read_receipts()
            router_address = self.settings.revenue_router_address or None
            bond_address = self.settings.agent_bond_address or None
            buyback_address = self.settings.buyback_vault_address or None
            creator_route_ready = bool(
                router_address
                and pons.get("available")
                and str(pons.get("creator_fee_recipient", "")).lower() == router_address.lower()
                and pons.get("buyback_enabled") is True
            )
            contracts_active = bool(
                router.get("deployed")
                and bond.get("deployed")
                and buyback.get("deployed")
                and router.get("paused") is False
                and bond.get("paused") is False
                and buyback.get("paused") is False
            )
            live = creator_route_ready and contracts_active
            result: dict[str, object] = {
                "generated_at": datetime.now(UTC).isoformat(),
                "status": "live" if live else "activation_pending",
                "status_detail": (
                    "Verified creator revenue is routing to active Agent Bonds."
                    if live
                    else (
                        "The public implementation is shipped. Mainnet fee routing and WETH rewards stay off until "
                        "verified contracts, Safe ownership, and the Pons creator-route transactions are confirmed."
                    )
                ),
                "network": {
                    "chain_id": self.settings.chain_id,
                    "chain_name": self.settings.chain_name,
                    "explorer_url": self.settings.explorer_url,
                },
                "contracts": {
                    "muppets": self.settings.muppets_token_address or None,
                    "weth": self.settings.weth_address,
                    "revenue_router": router_address,
                    "agent_bond": bond_address,
                    "buyback_vault": buyback_address,
                    "buyback_executor": self.settings.buyback_executor_address or None,
                    "universal_router": self.settings.universal_router_address or None,
                    "stock_reserve": self.settings.fee_rwa_reserve_address or None,
                    "pons_fee_policy": self.settings.pons_fee_policy_address or None,
                    "pons_fee_escrow": self.settings.pons_fee_escrow_address or None,
                    "pons_curve": self.settings.pons_curve_address or None,
                    "pons_pool_id": self.settings.pons_pool_id or None,
                },
                "reward_unit": {
                    "muppets": str(self.settings.muppets_token_minimum),
                    "bound_agent_keys": "1",
                    "lock_days": 30,
                    "maturation_days": 7,
                    "epoch_days": 7,
                    "terms": [
                        {"days": 30, "weight": "1x"},
                        {"days": 90, "weight": "1.25x"},
                        {"days": 180, "weight": "1.5x"},
                    ],
                    "formula": "min(floor(bonded MUPPETS / 15,000), committed bound Agent Keys)",
                    "creator_slots": "Bonded MUPPETS continue to count toward Creator Slots in FactoryV2.",
                },
                "target_fee_route": [
                    {"id": "pons_protocol", "label": "Pons protocol", "percent": "0.300%"},
                    {"id": "pons_buyback", "label": "Pons buyback and five-year vest", "percent": "0.350%"},
                    {"id": "agent_bonds", "label": "Agent Bond WETH rewards", "percent": "1.175%"},
                    {"id": "stock_reserve", "label": "LiquidMuppets Stock Token reserve", "percent": "0.705%"},
                    {"id": "operations", "label": "keeper and operations", "percent": "0.470%"},
                ],
                "router_split": {
                    "input": "creator revenue after Pons protocol and buyback routing",
                    "agent_bonds": "50%",
                    "stock_reserve": "30%",
                    "operations": "20%",
                    "cadence": "weekly",
                    "zero_revenue_rule": "No revenue means no reward distribution.",
                },
                "key_market_split": {
                    "input": "V2 Agent Key market fees attributed to the exact Key",
                    "agent_bond_weth": "50%",
                    "muppets_buyback": "25%",
                    "stock_token_reserve": "15%",
                    "operations": "10%",
                    "cadence": "weekly per Key",
                    "vesting": "Each buyback lot vests to the Safe over five years.",
                },
                "pons": pons,
                "router": router,
                "bond": bond,
                "buyback": buyback,
                "activation_checks": [
                    {"label": "Revenue Router deployed", "complete": bool(router.get("deployed"))},
                    {"label": "Agent Bond deployed", "complete": bool(bond.get("deployed"))},
                    {"label": "Buyback vault deployed", "complete": bool(buyback.get("deployed"))},
                    {"label": "Safe-controlled contracts active", "complete": contracts_active},
                    {"label": "Pons buyback enabled", "complete": pons.get("buyback_enabled") is True},
                    {"label": "Pons creator fees point to router", "complete": creator_route_ready},
                ],
                "tracking_started_at": tracking_started_at,
                "receipt_status": receipt_status,
                "receipts": receipts,
                "boundaries": [
                    "Agent Keys remain separate from vault shares and do not own vault assets.",
                    "Bond rewards come only from recorded revenue. They are not token emissions.",
                    (
                        "A position matures for seven days and earns only for full completed epochs. "
                        "A late bond cannot claim an earlier epoch."
                    ),
                    "Only V2 Key-market fills can be attributed to one Key. Legacy market fees remain global.",
                    (
                        "A limited keeper submits a quoted minimum output for each bounded buyback. "
                        "Purchased MUPPETS vest for five years."
                    ),
                    "No APY is projected or reconstructed before tracking begins.",
                    "The contracts are tested but have not been independently audited.",
                ],
            }
            self._cache = (now + 15, result)
            return result

    def _read_pons(self) -> dict[str, object]:
        base: dict[str, object] = {
            "available": False,
            "fee_policy": self.settings.pons_fee_policy_address or None,
            "pool_id": self.settings.pons_pool_id or None,
        }
        try:
            address = Web3.to_checksum_address(self.settings.pons_fee_policy_address)
            if len(self.web3.eth.get_code(address)) == 0:
                raise ValueError("Pons fee policy has no runtime code")
            pool_id = bytes.fromhex(self.settings.pons_pool_id.removeprefix("0x"))
            if len(pool_id) != 32:
                raise ValueError("invalid Pons pool id")
            block = self.web3.eth.block_number
            contract = self.web3.eth.contract(address=address, abi=PONS_LAUNCH_ABI)
            raw = contract.functions.launches(pool_id).call(block_identifier=block)
            block_data = self.web3.eth.get_block(block)
            hook_fee_bps = int(raw[10])
            protocol_fee_bps = hook_fee_bps * int(raw[8]) // 10_000
            buyback_bps = (hook_fee_bps - protocol_fee_bps) * int(raw[9]) // 10_000 if bool(raw[12]) else 0
            creator_revenue_bps = int(raw[7]) + hook_fee_bps - protocol_fee_bps - buyback_bps
            return {
                **base,
                "available": True,
                "registered": bool(raw[0]),
                "token": Web3.to_checksum_address(raw[2]),
                "creator": Web3.to_checksum_address(raw[4]),
                "creator_fee_recipient": Web3.to_checksum_address(raw[5]),
                "protocol_fee_recipient": Web3.to_checksum_address(raw[6]),
                "creator_tax_bps": int(raw[7]),
                "hook_fee_bps": hook_fee_bps,
                "protocol_fee_share_bps": int(raw[8]),
                "buyback_share_bps": int(raw[9]),
                "buyback_enabled": bool(raw[12]),
                "current_protocol_fee": _format_bps(protocol_fee_bps),
                "current_buyback_fee": _format_bps(buyback_bps),
                "current_creator_revenue": _format_bps(creator_revenue_bps),
                "block_number": block,
                "observed_at": datetime.fromtimestamp(int(block_data["timestamp"]), UTC).isoformat(),
            }
        except Exception as error:
            return {**base, "error": f"Pons fee read unavailable: {type(error).__name__}"}

    def _read_router(self) -> dict[str, object]:
        return self._read_contract_summary(
            self.settings.revenue_router_address,
            ROUTER_ABI,
            [
                "paused",
                "totalPonsRevenue",
                "totalMarketplaceRevenue",
                "totalLegacyMarketplaceRevenue",
                "totalKeyMarketplaceRevenue",
                "totalKeyMarketplaceVolume",
                "totalFundingReceived",
                "totalRevenueRouted",
                "totalBondRewardsDelivered",
                "totalBuybackRouted",
                "totalStockReserveRouted",
                "totalOperationsRouted",
                "pendingBondRewardsNative",
                "lastRouteAt",
            ],
        )

    def _read_bond(self) -> dict[str, object]:
        state = self._read_contract_summary(
            self.settings.agent_bond_address,
            BOND_ABI,
            ["paused", "totalRewardUnits", "totalBondedMuppets", "totalRewardsNotified", "totalRewardsClaimed"],
        )
        if not state.get("deployed"):
            return state
        try:
            address = Web3.to_checksum_address(self.settings.agent_bond_address)
            block_value = state.get("block_number")
            if not isinstance(block_value, int):
                raise ValueError("missing bond read block")
            block = block_value
            contract = self.web3.eth.contract(address=address, abi=BOND_ABI)
            epoch = contract.functions.latestCompletedEpoch().call(block_identifier=block)
            weight = contract.functions.totalRewardWeightAtEpoch(epoch).call(block_identifier=block)
            state["latest_completed_epoch"] = int(epoch)
            state["total_reward_weight_bps"] = str(int(weight))
            return state
        except Exception as error:
            return {**state, "epoch_error": type(error).__name__}

    def _read_buyback(self) -> dict[str, object]:
        return self._read_contract_summary(
            self.settings.buyback_vault_address,
            BUYBACK_ABI,
            [
                "paused",
                "totalPendingNative",
                "totalFundedNative",
                "totalSpentNative",
                "totalMuppetsPurchased",
            ],
        )

    def _read_contract_summary(
        self,
        configured_address: str,
        abi: list[dict[str, Any]],
        functions: list[str],
    ) -> dict[str, object]:
        if not Web3.is_address(configured_address):
            return {"deployed": False, "address": configured_address or None}
        try:
            address = Web3.to_checksum_address(configured_address)
            if len(self.web3.eth.get_code(address)) == 0:
                return {"deployed": False, "address": address}
            block = self.web3.eth.block_number
            contract = self.web3.eth.contract(address=address, abi=abi)
            state: dict[str, object] = {"deployed": True, "address": address, "block_number": block}
            for name in functions:
                value = getattr(contract.functions, name)().call(block_identifier=block)
                state[_snake_case(name)] = value if isinstance(value, bool) else str(int(value))
            return state
        except Exception as error:
            return {"deployed": False, "address": configured_address, "error": type(error).__name__}

    def _read_wallet(self, wallet: str | None) -> dict[str, object] | None:
        if wallet is None or not Web3.is_address(wallet):
            return None
        if not Web3.is_address(self.settings.agent_bond_address):
            return {"address": Web3.to_checksum_address(wallet), "available": False}
        try:
            address = Web3.to_checksum_address(self.settings.agent_bond_address)
            if len(self.web3.eth.get_code(address)) == 0:
                return {"address": Web3.to_checksum_address(wallet), "available": False}
            account = Web3.to_checksum_address(wallet)
            contract = self.web3.eth.contract(address=address, abi=BOND_ABI)
            block = self.web3.eth.block_number
            bonded, units, pending, position_count = (
                contract.functions.bondedBalance(account).call(block_identifier=block),
                contract.functions.rewardUnits(account).call(block_identifier=block),
                contract.functions.pendingTotalReward(account).call(block_identifier=block),
                contract.functions.accountPositionCount(account).call(block_identifier=block),
            )
            return {
                "address": account,
                "available": True,
                "bonded_muppets_raw": str(int(bonded)),
                "reward_units": str(int(units)),
                "pending_weth_raw": str(int(pending)),
                "position_count": str(int(position_count)),
                "block_number": block,
            }
        except Exception as error:
            return {"address": Web3.to_checksum_address(wallet), "available": False, "error": type(error).__name__}

    def _pending_key_state(self, key: str, receipt_status: str) -> dict[str, object]:
        return {
            "status": "activation_pending",
            "available": False,
            "key": key,
            "attribution": "exact_key_v2",
            "detail": (
                "Exact-Key accounting is implemented. Mainnet contracts remain inactive pending the release gates."
            ),
            "split": {
                "agent_bond_weth": "50%",
                "muppets_buyback": "25%",
                "stock_token_reserve": "15%",
                "operations": "10%",
            },
            "market": {"volume_raw": None, "fee_revenue_raw": None, "routed_raw": None},
            "bond": {
                "units": None,
                "eligible_weight_bps": None,
                "reward_epoch": None,
                "weth_per_1x_unit_raw": None,
                "weth_delivered_raw": None,
            },
            "buyback": {"funded_raw": None, "pending_raw": None, "spent_raw": None, "muppets_bought_raw": None},
            "tracking_started_at": None,
            "receipt_status": receipt_status,
            "receipts": [],
        }

    def _read_key_receipts(self, key: str) -> tuple[list[dict[str, object]], str | None, str]:
        addresses = [
            Web3.to_checksum_address(address)
            for address in (
                self.settings.revenue_router_address,
                self.settings.agent_bond_address,
                self.settings.buyback_vault_address,
                self.settings.key_marketplace_address,
            )
            if Web3.is_address(address)
        ]
        start = self.settings.revenue_deployment_block
        if len(addresses) < 3 or start <= 0:
            return [], None, "tracking_starts_at_contract_deployment"
        try:
            latest = self.web3.eth.block_number
            start_block = self.web3.eth.get_block(start)
            key_topic = Web3.to_hex(bytes.fromhex(key.removeprefix("0x")).rjust(32, b"\0")).lower()
            logs: list[Any] = []
            for chunk_start in range(start, latest + 1, 50_000):
                logs.extend(
                    self.web3.eth.get_logs(
                        {
                            "fromBlock": chunk_start,
                            "toBlock": min(chunk_start + 49_999, latest),
                            "address": addresses,
                        }
                    )
                )
            block_times: dict[int, str] = {}
            rows: list[dict[str, object]] = []
            for log in reversed(logs):
                indexed_topics = {topic.hex().lower() for topic in log["topics"][1:]}
                if key_topic not in indexed_topics:
                    continue
                block_number = int(log["blockNumber"])
                if block_number not in block_times:
                    block = self.web3.eth.get_block(block_number)
                    block_times[block_number] = datetime.fromtimestamp(int(block["timestamp"]), UTC).isoformat()
                tx_hash = log["transactionHash"].hex()
                topic = log["topics"][0].hex() if log["topics"] else ""
                rows.append(
                    {
                        "action": EVENT_LABELS.get(topic, "Key revenue record"),
                        "contract": Web3.to_checksum_address(log["address"]),
                        "tx_hash": tx_hash,
                        "log_index": int(log["logIndex"]),
                        "block_number": block_number,
                        "timestamp": block_times[block_number],
                        "url": f"{self.settings.explorer_url}/tx/{tx_hash}",
                    }
                )
                if len(rows) >= 100:
                    break
            tracking = datetime.fromtimestamp(int(start_block["timestamp"]), UTC).isoformat()
            return rows, tracking, "available"
        except Exception as error:
            return [], None, f"unavailable:{type(error).__name__}"

    def _read_receipts(self) -> tuple[list[dict[str, object]], str | None, str]:
        addresses = [
            Web3.to_checksum_address(address)
            for address in (
                self.settings.revenue_router_address,
                self.settings.agent_bond_address,
                self.settings.buyback_vault_address,
            )
            if Web3.is_address(address)
        ]
        start = self.settings.revenue_deployment_block
        if len(addresses) != 3 or start <= 0:
            return [], None, "tracking_starts_at_contract_deployment"
        try:
            latest = self.web3.eth.block_number
            start_block = self.web3.eth.get_block(start)
            logs: list[Any] = []
            for chunk_start in range(start, latest + 1, 50_000):
                logs.extend(
                    self.web3.eth.get_logs(
                        {
                            "fromBlock": chunk_start,
                            "toBlock": min(chunk_start + 49_999, latest),
                            "address": addresses,
                        }
                    )
                )
            block_times: dict[int, str] = {}
            rows: list[dict[str, object]] = []
            seen: set[str] = set()
            for log in reversed(logs):
                tx_hash = log["transactionHash"].hex()
                if tx_hash in seen:
                    continue
                seen.add(tx_hash)
                block_number = int(log["blockNumber"])
                if block_number not in block_times:
                    block = self.web3.eth.get_block(block_number)
                    block_times[block_number] = datetime.fromtimestamp(int(block["timestamp"]), UTC).isoformat()
                topic = log["topics"][0].hex() if log["topics"] else ""
                rows.append(
                    {
                        "action": EVENT_LABELS.get(topic, "contract record"),
                        "contract": Web3.to_checksum_address(log["address"]),
                        "tx_hash": tx_hash,
                        "block_number": block_number,
                        "timestamp": block_times[block_number],
                        "url": f"{self.settings.explorer_url}/tx/{tx_hash}",
                    }
                )
                if len(rows) >= 100:
                    break
            tracking = datetime.fromtimestamp(int(start_block["timestamp"]), UTC).isoformat()
            return rows, tracking, "available"
        except Exception as error:
            return [], None, f"unavailable:{type(error).__name__}"


def _format_bps(value: int) -> str:
    whole, fraction = divmod(value, 100)
    return f"{whole}.{fraction:02d}%"


def _snake_case(value: str) -> str:
    rendered = ""
    for character in value:
        if character.isupper():
            rendered += "_" + character.lower()
        else:
            rendered += character
    return rendered
