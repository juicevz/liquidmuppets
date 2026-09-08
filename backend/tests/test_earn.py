from dataclasses import replace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from hexbytes import HexBytes
from web3 import Web3

from app.config import Settings
from app.services.earn import CLAIM_TOPIC, REINVEST_TOPIC, EarnService, decode_wallet_receipts

WALLET = "0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f"
BOND = "0x1111111111111111111111111111111111111111"
KEY = "0x2222222222222222222222222222222222222222"
ROUTER = "0x3333333333333333333333333333333333333333"
OTHER = "0x4444444444444444444444444444444444444444"
BLOCK = 50_000
UNIT = 15_000 * 10**18
EXPLORER = "https://explorer.invalid"


class FakeBatch:
    def __init__(self, sizes: list[int]) -> None:
        self.values: list[Any] = []
        self.sizes = sizes

    def __enter__(self) -> "FakeBatch":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def add(self, value: Any) -> None:
        self.values.append(value)

    def execute(self) -> list[Any]:
        self.sizes.append(len(self.values))
        return self.values


def call_value(value: Any) -> MagicMock:
    function = MagicMock()
    function.call.return_value = value
    return function


def fixture(count: int = 2) -> tuple[EarnService, dict[str, object], MagicMock, MagicMock, list[int]]:
    settings = Settings(
        agent_bond_address=BOND, revenue_router_address=ROUTER, revenue_deployment_block=100,
        explorer_url=EXPLORER, rpc_url="http://127.0.0.1:1",
    )
    rpc, bond = MagicMock(), MagicMock()
    sizes: list[int] = []
    rpc.batch_requests.side_effect = lambda: FakeBatch(sizes)
    rpc.eth.block_number = BLOCK
    rpc.eth.contract.return_value = bond
    rpc.eth.get_code.return_value = b"\x60"
    rpc.eth.get_logs.return_value = []
    rpc.eth.get_block.return_value = {"timestamp": 1_000_000}
    bond.functions.EARN_ACCOUNTING_VERSION().call.return_value = 1
    bond.functions.accountRewardsClaimed(WALLET).call.return_value = 100
    bond.functions.accountRewardsReinvested(WALLET).call.return_value = 40
    bond.functions.UNIT_SIZE().call.return_value = UNIT
    bond.functions.accountPositionAt.side_effect = lambda account, index: call_value(index + 1)
    bond.functions.getPosition.side_effect = lambda position_id: call_value((
        WALLET, KEY, 1, 10_000, 100, 604_900, 2_592_100, 2, 4, 10_000, 0, position_id == 1,
    ))
    bond.functions.pendingPositionRewards.side_effect = lambda position_id: call_value(
        (position_id * 5, position_id * 2)
    )
    wallet: dict[str, object] = {
        "available": True, "address": WALLET, "bonded_muppets_raw": str(UNIT),
        "pending_weth_raw": "21", "position_count": str(count), "block_number": BLOCK,
    }
    return EarnService(settings, cast(Web3, rpc)), wallet, rpc, bond, sizes


def test_wallet_earn_separates_lifetime_cash_from_reinvested_rewards() -> None:
    service, wallet, rpc, bond, sizes = fixture()
    state = service.read_wallet(WALLET, wallet)

    assert state["status"] == "available"
    assert state["claimed_weth_raw"] == "100"
    assert state["reinvested_weth_raw"] == "40"
    assert state["received_weth_raw"] == "60"
    assert state["claimable_weth_raw"] == "21"
    assert state["accounting_status"] == "contract_totals"
    positions = cast(list[dict[str, Any]], state["positions"])
    assert [position["id"] for position in positions] == ["2", "1"]
    assert positions[0]["eligible_from"] == 2 * 604_800
    assert positions[0]["eligible_until"] == 4 * 604_800
    assert positions[0]["matures_at"] != positions[0]["eligible_from"]
    assert positions[1]["withdrawn"] is True
    assert positions[1]["claimable_global_weth_raw"] == "5"
    assert state["next_position_cursor"] is None
    assert all(size <= 10 for size in sizes)
    bond.functions.EARN_ACCOUNTING_VERSION().call.assert_called_once_with(block_identifier=BLOCK)
    calls = rpc.eth.get_logs.call_args_list
    assert len(calls) == 2
    assert calls[0].args[0]["fromBlock"] == BLOCK - 2 - 9_999
    assert calls[0].args[0]["toBlock"] == BLOCK - 2
    assert calls[0].args[0]["topics"][2].endswith(WALLET[2:].lower())
    assert calls[1].args[0]["topics"][3].endswith(WALLET[2:].lower())


def test_pending_contracts_return_null_amounts_without_rpc() -> None:
    service, _, rpc, _, _ = fixture()
    service.settings = replace(service.settings, agent_bond_address="")
    state = service.read_wallet(WALLET, {"available": False})

    assert state["status"] == "activation_pending"
    for field in ("staked_muppets_raw", "claimable_weth_raw", "claimed_weth_raw", "received_weth_raw"):
        assert state[field] is None
    assert state["positions_total"] is None
    rpc.eth.contract.assert_not_called()


def test_rpc_failure_is_unavailable_instead_of_empty_wallet() -> None:
    service, _, _, _, _ = fixture()
    state = service.read_wallet(WALLET, {"available": False})
    assert state["status"] == "unavailable"
    assert state["staked_muppets_raw"] is None


@pytest.mark.parametrize("failure", ["legacy", "rpc", "inconsistent"])
def test_missing_lifetime_counter_does_not_hide_current_balances_or_invent_zero(failure: str) -> None:
    service, wallet, _, bond, _ = fixture()
    if failure == "legacy":
        bond.functions.EARN_ACCOUNTING_VERSION().call.return_value = 0
    elif failure == "rpc":
        bond.functions.EARN_ACCOUNTING_VERSION().call.side_effect = ValueError("unavailable")
    else:
        bond.functions.accountRewardsReinvested(WALLET).call.return_value = 101
    state = service.read_wallet(WALLET, wallet)

    assert state["accounting_status"] == "unavailable"
    assert state["claimed_weth_raw"] is None
    assert state["received_weth_raw"] is None
    assert state["staked_muppets_raw"] == str(UNIT)
    assert state["positions_status"] == "available"


def test_positions_are_paged_and_oldest_page_is_not_lifetime_aggregate() -> None:
    service, wallet, _, bond, sizes = fixture(count=52)
    first = service.read_wallet(WALLET, wallet)
    second = service.read_wallet(WALLET, wallet, 50)

    assert len(cast(list[object], first["positions"])) == 50
    assert first["next_position_cursor"] == 50
    assert first["positions_truncated"] is True
    assert [row["id"] for row in cast(list[dict[str, Any]], second["positions"])] == ["2", "1"]
    assert second["next_position_cursor"] is None
    assert second["claimed_weth_raw"] == first["claimed_weth_raw"] == "100"
    assert bond.functions.accountPositionAt.call_count == 52
    assert all(size <= 10 for size in sizes)


def test_wallet_empty_is_zero_only_after_successful_contract_read() -> None:
    service, wallet, _, bond, _ = fixture(count=0)
    wallet.update({"bonded_muppets_raw": "0", "pending_weth_raw": "0"})
    bond.functions.accountRewardsClaimed(WALLET).call.return_value = 0
    bond.functions.accountRewardsReinvested(WALLET).call.return_value = 0
    state = service.read_wallet(WALLET, wallet)
    assert state["status"] == "available"
    assert state["claimed_weth_raw"] == "0"
    assert state["claimable_weth_raw"] == "0"
    assert state["positions"] == []
    assert state["positions_status"] == "available"


def test_position_read_failure_does_not_clear_lifetime_or_current_amounts() -> None:
    service, wallet, _, bond, _ = fixture()
    bond.functions.getPosition.side_effect = ValueError("position query failed")
    state = service.read_wallet(WALLET, wallet)
    assert state["positions_status"] == "unavailable"
    assert state["positions"] == []
    assert state["positions_total"] == "2"
    assert state["claimed_weth_raw"] == "100"


def test_cached_wallet_does_not_repeat_history_queries() -> None:
    service, wallet, rpc, _, _ = fixture()
    first = service.read_wallet(WALLET, wallet)
    second = service.read_wallet(WALLET, wallet)
    assert second is first
    assert rpc.eth.get_logs.call_count == 2


def topic(value: str | int) -> HexBytes:
    return HexBytes(int(value, 16).to_bytes(32, "big") if isinstance(value, str) else value.to_bytes(32, "big"))


def event(kind: str, index: int, values: list[int], *, wallet: str = WALLET, position: int = 1) -> dict[str, Any]:
    topics = [HexBytes(CLAIM_TOPIC), topic(position), topic(wallet), topic(KEY)] if kind == "claim" else [
        HexBytes(REINVEST_TOPIC), topic(position), topic(2), topic(wallet),
    ]
    return {
        "address": BOND, "blockNumber": BLOCK - 3, "logIndex": index,
        "transactionHash": HexBytes("0x" + "ab" * 32), "topics": topics,
        "data": HexBytes(b"".join(value.to_bytes(32, "big") for value in values)),
    }


def test_claim_receipt_keeps_global_and_exact_key_sources_distinct() -> None:
    rows = decode_wallet_receipts([event("claim", 0, [70, 30])], WALLET, BOND, EXPLORER)
    assert len(rows) == 1
    assert rows[0]["global_weth_raw"] == "70"
    assert rows[0]["key_weth_raw"] == "30"
    assert rows[0]["key"] == KEY
    assert rows[0]["received_weth_raw"] == rows[0]["claimed_weth_raw"] == "100"
    assert rows[0]["reinvested_weth_raw"] == "0"


def test_reinvested_receipt_is_one_row_and_does_not_count_spending_as_wallet_cash() -> None:
    claim = event("claim", 0, [70, 30])
    reinvest = event("reinvest", 3, [60, UNIT + 99, UNIT, 40, 99])
    rows = decode_wallet_receipts([reinvest, claim, claim], WALLET, BOND, EXPLORER)
    assert len(rows) == 1
    assert rows[0]["kind"] == "reinvested"
    assert rows[0]["claimed_weth_raw"] == "100"
    assert rows[0]["received_weth_raw"] == "40"
    assert rows[0]["reinvested_weth_raw"] == "60"
    assert rows[0]["global_weth_raw"] == "70"
    assert rows[0]["key_weth_raw"] == "30"
    assert rows[0]["new_position_id"] == "2"
    assert rows[0]["log_index"] == 3


def test_wallet_history_excludes_other_accounts_contracts_deposits_and_removed_logs() -> None:
    other = event("claim", 0, [10, 0], wallet=OTHER)
    removed = event("claim", 1, [20, 0]) | {"removed": True}
    wrong_contract = event("claim", 2, [30, 0]) | {"address": OTHER}
    deposit = event("claim", 3, [40, 0]) | {"topics": [topic(42), topic(WALLET), topic(KEY), topic(1)]}
    assert decode_wallet_receipts([other, removed, wrong_contract, deposit], WALLET, BOND, EXPLORER) == []


@pytest.mark.parametrize("logs", [
    [event("reinvest", 1, [60, UNIT, UNIT, 40, 0])],
    [event("claim", 0, [70, 30]), event("reinvest", 1, [60, UNIT, UNIT, 50, 0])],
    [event("claim", 0, [70])],
])
def test_malformed_or_unreconciled_receipts_fail_closed(logs: list[Any]) -> None:
    with pytest.raises(ValueError):
        decode_wallet_receipts(logs, WALLET, BOND, EXPLORER)


def test_receipt_failures_do_not_change_valid_lifetime_counters() -> None:
    service, wallet, rpc, _, _ = fixture()
    rpc.eth.get_logs.side_effect = ValueError("upstream unavailable")
    state = service.read_wallet(WALLET, wallet)
    assert state["receipt_status"] == "unavailable"
    assert state["claimed_weth_raw"] == "100"
    assert state["received_weth_raw"] == "60"


def test_receipt_week_read_is_bounded_source_labeled_and_excludes_unallocated_from_paid() -> None:
    service, _, rpc, router, sizes = fixture()
    router.functions.REVENUE_EPOCH_VERSION().call.return_value = 1
    router.functions.ROUTE_INTERVAL().call.return_value = 604_800
    router.functions.globalRevenueEpochCount().call.return_value = 12
    router.functions.globalRevenueEpochAt.side_effect = lambda index: call_value(index + 2000)
    router.functions.globalRevenueEpoch.side_effect = lambda epoch: call_value((
        100, 0, 90, 10, 50, 0, 50, 0, 30, 20, 0, 1_000_000,
    ))
    state = service.read_weeks()
    rows = cast(list[dict[str, Any]], state["rows"])

    assert state["status"] == "available"
    assert state["accounting"] == "router_receipt_week"
    assert state["has_more"] is True
    assert len(rows) == 8
    assert rows[0]["epoch"] == 2011
    assert rows[0]["source"] == "global"
    assert rows[0]["pons_wei"] == "90"
    assert rows[0]["legacy_key_fees_wei"] == "10"
    assert rows[0]["unallocated_bond_rewards_wei"] == "50"
    assert rows[0]["bond_rewards_delivered_wei"] == "0"
    assert all(size <= 10 for size in sizes)
    rpc.eth.get_code.assert_called_once_with(ROUTER, block_identifier=BLOCK)


def test_exact_key_weeks_use_only_that_key() -> None:
    service, _, _, router, _ = fixture()
    router.functions.REVENUE_EPOCH_VERSION().call.return_value = 1
    router.functions.ROUTE_INTERVAL().call.return_value = 604_800
    router.functions.keyRevenueEpochCount(KEY).call.return_value = 1
    router.functions.keyRevenueEpochAt(KEY, 0).call.return_value = 2010
    router.functions.keyRevenueEpoch(KEY, 2010).call.return_value = (100, 3000, 0, 0, 50, 50, 0, 25, 15, 10, 1, 2000)
    state = service.read_weeks(KEY)
    row = cast(list[dict[str, Any]], state["rows"])[0]
    assert row["source"] == "exact_key"
    assert row["source_key"] == KEY
    assert row["key_volume_wei"] == "3000"
    assert row["buyback_wei"] == "25"
    router.functions.globalRevenueEpochCount.assert_not_called()


@pytest.mark.parametrize("mode,status", [
    ("pending", "activation_pending"), ("no_code", "activation_pending"),
    ("legacy", "legacy"), ("rpc", "unavailable"),
])
def test_weekly_accounting_never_makes_up_zero_history(mode: str, status: str) -> None:
    service, _, rpc, router, _ = fixture()
    if mode == "pending":
        service.settings = replace(service.settings, revenue_router_address="")
    elif mode == "no_code":
        rpc.eth.get_code.return_value = b""
    elif mode == "legacy":
        router.functions.REVENUE_EPOCH_VERSION().call.return_value = 0
    else:
        router.functions.REVENUE_EPOCH_VERSION().call.side_effect = ValueError("unavailable")
    state = service.read_weeks()
    assert state["status"] == status
    assert state["total_weeks"] is None
    assert state["rows"] == []
