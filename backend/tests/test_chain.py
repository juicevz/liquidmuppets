from typing import Any

from pytest import MonkeyPatch

from app.config import Settings
from app.services import chain as chain_module
from app.services.chain import ChainService


class FakeBatch:
    def __init__(self, sizes: list[int]) -> None:
        self.calls: list[Any] = []
        self.sizes = sizes

    def __enter__(self) -> "FakeBatch":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def add(self, call: Any) -> None:
        self.calls.append(call)

    def execute(self) -> list[Any]:
        self.sizes.append(len(self.calls))
        return self.calls


class FakeWeb3:
    def __init__(self) -> None:
        self.batch_sizes: list[int] = []

    def batch_requests(self) -> FakeBatch:
        return FakeBatch(self.batch_sizes)


def test_rwa_reads_split_large_rpc_batches() -> None:
    service = ChainService(Settings(rpc_url="https://rpc.invalid"))
    fake_web3 = FakeWeb3()
    service.web3 = fake_web3  # type: ignore[assignment]

    assert service._batch_call(list(range(25))) == list(range(25))
    assert fake_web3.batch_sizes == [10, 10, 5]


def test_rwa_read_returns_last_confirmed_state_after_rpc_failure(monkeypatch: MonkeyPatch) -> None:
    service = ChainService(Settings(rpc_url="https://rpc.invalid"))
    service._rwa_cache = (0.0, {"configured": True, "blockNumber": 123})
    attempts = 0

    def fail_read(*, fresh: bool = False) -> dict[str, object]:
        nonlocal attempts
        attempts += 1
        raise RuntimeError(f"upstream unavailable, fresh={fresh}")

    monkeypatch.setattr(service, "_read_rwa_reserve_once", fail_read)
    monkeypatch.setattr(chain_module, "sleep", lambda _: None)

    state = service.read_rwa_reserve()

    assert attempts == len(chain_module.RWA_READ_RETRY_DELAYS)
    assert state == {"configured": True, "blockNumber": 123, "stale": True}
