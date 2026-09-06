from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from threading import Lock
from typing import Any, TypeVar

from web3.providers import JSONBaseProvider
from web3.providers.rpc import HTTPProvider
from web3.types import RPCEndpoint, RPCResponse

logger = logging.getLogger(__name__)

T = TypeVar("T")


class FailoverHTTPProvider(JSONBaseProvider):
    """A small ordered RPC pool that keeps reads on the last healthy endpoint."""

    def __init__(self, urls: Sequence[str], *, timeout: float = 12) -> None:
        super().__init__()
        cleaned = tuple(dict.fromkeys(url.strip() for url in urls if url.strip()))
        if not cleaned:
            raise ValueError("at least one RPC URL is required")
        self._providers = tuple(
            HTTPProvider(endpoint_uri=url, request_kwargs={"timeout": timeout}) for url in cleaned
        )
        self._active_index = 0
        self._lock = Lock()

    @property
    def endpoint_count(self) -> int:
        return len(self._providers)

    @property
    def active_index(self) -> int:
        with self._lock:
            return self._active_index

    @property
    def active_source(self) -> str:
        return "primary" if self.active_index == 0 else "fallback"

    def make_request(self, method: RPCEndpoint, params: Any) -> RPCResponse:
        return self._try_endpoints(lambda provider: provider.make_request(method, params))

    def make_batch_request(
        self,
        batch_requests: list[tuple[RPCEndpoint, Any]],
    ) -> list[RPCResponse] | RPCResponse:
        return self._try_endpoints(lambda provider: provider.make_batch_request(batch_requests))

    def is_connected(self, show_traceback: bool = False) -> bool:
        for index in self._ordered_indices():
            try:
                if self._providers[index].is_connected(show_traceback=show_traceback):
                    self._mark_healthy(index)
                    return True
            except Exception:
                if show_traceback:
                    raise
        return False

    def _try_endpoints(self, operation: Callable[[HTTPProvider], T]) -> T:
        last_error: Exception | None = None
        retryable_response: T | None = None
        for index in self._ordered_indices():
            try:
                response = operation(self._providers[index])
            except Exception as error:
                last_error = error
                continue
            if _retryable_rpc_response(response):
                retryable_response = response
                continue
            self._mark_healthy(index)
            return response
        if last_error is not None:
            raise last_error
        if retryable_response is not None:
            return retryable_response
        raise RuntimeError("RPC failover pool did not execute")

    def _ordered_indices(self) -> tuple[int, ...]:
        active = self.active_index
        return tuple([active, *(index for index in range(len(self._providers)) if index != active)])

    def _mark_healthy(self, index: int) -> None:
        with self._lock:
            previous = self._active_index
            self._active_index = index
        if index != previous:
            logger.warning("RPC source changed from %s to %s", _source(previous), _source(index))


def _source(index: int) -> str:
    return "primary" if index == 0 else f"fallback-{index}"


def _retryable_rpc_response(value: object) -> bool:
    rows = value if isinstance(value, list) else [value]
    for row in rows:
        if not isinstance(row, dict) or "error" not in row:
            continue
        error = row.get("error")
        if not isinstance(error, dict):
            continue
        code = error.get("code")
        message = str(error.get("message", "")).lower()
        if code in {-32005, -32016, -32603}:
            return True
        if any(marker in message for marker in ("rate limit", "too many", "timeout", "unavailable", "gateway")):
            return True
    return False
