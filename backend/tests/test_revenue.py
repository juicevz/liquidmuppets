from dataclasses import replace
from typing import cast
from unittest.mock import MagicMock

import pytest
from web3 import Web3

from app.config import Settings
from app.services.revenue import EVENT_LABELS, RevenueService

BOND = "0x1111111111111111111111111111111111111111"
EXECUTOR = "0x2222222222222222222222222222222222222222"
MUPPETS = "0x3333333333333333333333333333333333333333"
WETH = "0x4444444444444444444444444444444444444444"
ROUTER = "0x5555555555555555555555555555555555555555"
HOOK = "0x6666666666666666666666666666666666666666"
OTHER = "0x9999999999999999999999999999999999999999"
POOL = "0x" + "77" * 32
BLOCK = 1234


def test_reinvestment_receipt_has_an_explicit_label() -> None:
    topic = Web3.keccak(
        text="PositionRewardsReinvested(uint256,uint256,address,uint256,uint256,uint256,uint256,uint256)"
    ).hex()
    assert EVENT_LABELS[topic] == "earned WETH reinvested into a new Agent Bond"


def reinvestment_fixture() -> tuple[RevenueService, MagicMock, MagicMock, MagicMock]:
    settings = Settings(
        rpc_url="http://127.0.0.1:1",
        agent_bond_address=BOND,
        buyback_executor_address=EXECUTOR,
        muppets_token_address=MUPPETS,
        weth_address=WETH,
        universal_router_address=ROUTER,
        pons_fee_policy_address=HOOK,
        pons_pool_id=POOL,
        muppets_token_minimum=15_000,
    )
    rpc = MagicMock()
    rpc.eth.block_number = BLOCK
    rpc.eth.get_code.return_value = b"\x60\x00"
    bond = MagicMock()
    executor = MagicMock()
    bond.functions.REINVESTMENT_VERSION().call.return_value = 1
    bond.functions.REWARD_BUY_EXECUTOR().call.return_value = EXECUTOR
    bond.functions.MUPPETS().call.return_value = MUPPETS
    bond.functions.WETH().call.return_value = WETH
    bond.functions.UNIT_SIZE().call.return_value = 15_000 * 10**18
    bond.functions.paused().call.return_value = False
    executor.functions.MUPPETS().call.return_value = MUPPETS
    executor.functions.UNIVERSAL_ROUTER().call.return_value = ROUTER
    executor.functions.PONS_HOOK().call.return_value = HOOK
    executor.functions.POOL_ID().call.return_value = Web3.to_bytes(hexstr=POOL)
    rpc.eth.contract.side_effect = lambda *, address, abi: bond if address == BOND else executor
    return RevenueService(settings, cast(Web3, rpc)), rpc, bond, executor


def test_reinvestment_pending_skips_capability_reads() -> None:
    service, rpc, _, _ = reinvestment_fixture()
    state = service._read_reinvestment(live=False)

    assert state["available"] is False
    assert state["minimum_muppets_raw"] == "15000000000000000000000"
    assert state["maximum_deadline_seconds"] == 300
    assert state["capability"] == "claim_buy_and_bond"
    assert state["version"] == 1
    assert "activation is pending" in str(state["reason"])
    rpc.eth.get_code.assert_not_called()
    rpc.eth.contract.assert_not_called()


def test_reinvestment_checks_matching_contracts_at_one_block() -> None:
    service, rpc, bond, executor = reinvestment_fixture()
    state = service._read_reinvestment(live=True)

    assert state["available"] is True
    assert state["executor"] == EXECUTOR
    assert state["block_number"] == BLOCK
    assert "earned rewards" in str(state["reason"])
    assert rpc.eth.get_code.call_count == 6
    assert all(call.kwargs["block_identifier"] == BLOCK for call in rpc.eth.get_code.call_args_list)
    for contract, methods in (
        (bond, ("REINVESTMENT_VERSION", "REWARD_BUY_EXECUTOR", "MUPPETS", "WETH", "UNIT_SIZE", "paused")),
        (executor, ("MUPPETS", "UNIVERSAL_ROUTER", "PONS_HOOK", "POOL_ID")),
    ):
        for method in methods:
            getattr(contract.functions, method)().call.assert_called_once_with(block_identifier=BLOCK)


@pytest.mark.parametrize(
    "field,value",
    [
        ("agent_bond_address", ""),
        ("buyback_executor_address", ""),
        ("buyback_executor_address", "0x" + "00" * 20),
        ("muppets_token_address", "wrong-token"),
        ("weth_address", ""),
        ("universal_router_address", ""),
        ("pons_fee_policy_address", ""),
        ("pons_pool_id", "0x1234"),
        ("pons_pool_id", "not-hex"),
    ],
)
def test_reinvestment_fails_closed_on_incomplete_configuration(field: str, value: str) -> None:
    service, rpc, _, _ = reinvestment_fixture()
    service.settings = replace(service.settings, **{field: value})

    assert service._read_reinvestment(live=True)["available"] is False
    rpc.eth.contract.assert_not_called()


@pytest.mark.parametrize("missing", [BOND, EXECUTOR, MUPPETS, WETH, ROUTER, HOOK])
def test_reinvestment_requires_deployed_route_code(missing: str) -> None:
    service, rpc, _, _ = reinvestment_fixture()
    rpc.eth.get_code.side_effect = lambda address, *, block_identifier: b"" if address == missing else b"\x60"

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "not been deployed" in str(state["reason"])
    rpc.eth.contract.assert_not_called()


@pytest.mark.parametrize("version", [0, 2])
def test_reinvestment_rejects_unsupported_capability_version(version: int) -> None:
    service, _, bond, _ = reinvestment_fixture()
    bond.functions.REINVESTMENT_VERSION().call.return_value = version

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "does not support" in str(state["reason"])


def test_reinvestment_rejects_legacy_bond_without_capability_getter() -> None:
    service, _, bond, _ = reinvestment_fixture()
    bond.functions.REINVESTMENT_VERSION().call.side_effect = ValueError("execution reverted")

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "could not be verified" in str(state["reason"])


@pytest.mark.parametrize(
    "contract_name,getter,value",
    [
        ("bond", "REWARD_BUY_EXECUTOR", OTHER),
        ("bond", "MUPPETS", OTHER),
        ("bond", "WETH", OTHER),
        ("bond", "UNIT_SIZE", 1),
        ("executor", "MUPPETS", OTHER),
        ("executor", "UNIVERSAL_ROUTER", OTHER),
        ("executor", "PONS_HOOK", OTHER),
        ("executor", "POOL_ID", bytes.fromhex("88" * 32)),
    ],
)
def test_reinvestment_rejects_mismatched_immutable_routes(contract_name: str, getter: str, value: object) -> None:
    service, _, bond, executor = reinvestment_fixture()
    contract = bond if contract_name == "bond" else executor
    getattr(contract.functions, getter)().call.return_value = value

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "does not match" in str(state["reason"])


def test_reinvestment_refresh_rejects_newly_paused_bond() -> None:
    service, _, bond, _ = reinvestment_fixture()
    bond.functions.paused().call.return_value = True

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "paused" in str(state["reason"])


def test_reinvestment_rpc_failure_never_enables_action() -> None:
    service, rpc, _, _ = reinvestment_fixture()
    rpc.eth.get_code.side_effect = TimeoutError("do not publish raw provider details")

    state = service._read_reinvestment(live=True)

    assert state["available"] is False
    assert "could not be verified" in str(state["reason"])
    assert "provider details" not in str(state)
