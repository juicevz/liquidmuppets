from typing import cast
from unittest.mock import MagicMock

from web3.types import RPCEndpoint

from app.services.rpc import FailoverHTTPProvider


def test_failover_provider_moves_reads_to_the_last_healthy_endpoint() -> None:
    provider = FailoverHTTPProvider(("https://primary.invalid", "https://fallback.invalid"))
    primary = MagicMock()
    fallback = MagicMock()
    primary.make_request.return_value = {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {"code": -32005, "message": "rate limit exceeded"},
    }
    fallback.make_request.return_value = {"jsonrpc": "2.0", "id": 1, "result": "0x1237"}
    provider._providers = (primary, fallback)

    response = provider.make_request(
        cast(RPCEndpoint, "eth_chainId"),
        [],
    )

    assert response["result"] == "0x1237"
    assert provider.active_source == "fallback"

    provider.make_request(cast(RPCEndpoint, "eth_chainId"), [])
    assert fallback.make_request.call_count == 2
    assert primary.make_request.call_count == 1
