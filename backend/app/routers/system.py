from __future__ import annotations

import json
from time import monotonic, sleep
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Body, HTTPException, Request, Response

from app.schemas import HealthResponse

router = APIRouter(tags=["system"])

READ_ONLY_RPC_METHODS = frozenset(
    {
        "eth_blockNumber",
        "eth_call",
        "eth_chainId",
        "eth_feeHistory",
        "eth_gasPrice",
        "eth_getBalance",
        "eth_getBlockByHash",
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_getLogs",
        "eth_getStorageAt",
        "eth_getTransactionByHash",
        "eth_getTransactionCount",
        "eth_getTransactionReceipt",
        "net_version",
        "web3_clientVersion",
    }
)
RPC_RETRY_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
RPC_RETRY_DELAYS = (0.0, 0.2, 0.6, 1.2, 2.5)
RPC_CACHE_SECONDS = 15
RPC_UPSTREAM_BATCH_SIZE = 10


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    chain = request.app.state.chain
    connected, block = chain.health()
    return HealthResponse(
        status="ok" if connected else "degraded",
        environment=settings.app_env,
        chain_id=settings.chain_id,
        chain_name=settings.chain_name,
        rpc_connected=connected,
        rpc_source=chain.rpc_source,
        rpc_endpoint_count=len(settings.rpc_urls),
        latest_block=block,
        contracts_configured=chain.contracts_configured,
        rwa_reserve_configured=chain.rwa_reserve_configured,
        keeper_configured=chain.keeper_configured,
        activity_status=request.app.state.activity.cache_status,
    )


@router.get("/contracts")
def contracts(request: Request) -> dict[str, object]:
    settings = request.app.state.settings
    return {
        "chainId": settings.chain_id,
        "chainName": settings.chain_name,
        "explorerUrl": settings.explorer_url,
        "rpcUrl": settings.browser_rpc_url,
        "deploymentBlock": settings.deployment_block,
        "factoryVersion": settings.factory_version,
        "factory": settings.factory_address or None,
        "legacyFactory": settings.legacy_factory_address or None,
        "legacyAgentCount": settings.legacy_agent_count,
        "policyExecutor": settings.policy_executor_address or None,
        "keyMarketplace": settings.key_marketplace_address or None,
        "legacyKeyMarketplace": settings.legacy_key_marketplace_address or None,
        "feeRwaReserve": settings.fee_rwa_reserve_address or None,
        "testUSDG": settings.test_usdg_address or None,
        "testWETH": settings.test_weth_address or None,
        "stablePool": settings.stable_pool_address or None,
        "ethPool": settings.eth_pool_address or None,
        "launchPool": settings.launch_pool_address or None,
        "USDG": settings.usdg_address,
        "morpho": settings.morpho_address,
        "stableMarketId": settings.stable_market_id,
        "stableAdapter": settings.stable_adapter_address or None,
        "rangeAdapter": settings.range_adapter_address or None,
        "launchReserveAdapter": settings.launch_reserve_adapter_address or None,
        "WETH": settings.weth_address,
        "ezWrapper": settings.ez_wrapper_address,
        "accessGate": {
            "feature": "agent_launch",
            "model": "creator_slots",
            "tokenAddress": settings.muppets_token_address or None,
            "tokenSymbol": settings.muppets_token_symbol,
            "minimum": str(settings.muppets_token_minimum),
            "slotSize": str(settings.muppets_token_minimum),
            "formula": "floor(balance / slotSize)",
            "configured": request.app.state.token_gate.configured,
            "enforcement": "onchain" if settings.factory_version >= 2 else "app_and_api",
        },
        "mode": "testnet" if settings.chain_id == 46630 else "mainnet",
    }


@router.get("/rwa-reserve")
def rwa_reserve(request: Request) -> dict[str, object]:
    try:
        state: dict[str, object] = request.app.state.chain.read_rwa_reserve()
        return state
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"RWA reserve read failed: {type(error).__name__}") from error


@router.post("/rpc")
def rpc_proxy(request: Request, payload: Annotated[Any, Body()]) -> Response:
    calls = payload if isinstance(payload, list) else [payload]
    if not calls or len(calls) > 50 or any(not isinstance(call, dict) for call in calls):
        raise HTTPException(status_code=400, detail="invalid JSON-RPC payload")
    if any(call.get("method") not in READ_ONLY_RPC_METHODS for call in calls):
        raise HTTPException(status_code=403, detail="JSON-RPC method is not allowed")

    cacheable = all(call.get("method") == "eth_call" for call in calls)
    cache_key = json.dumps(payload, sort_keys=True, separators=(",", ":")) if cacheable else ""
    force_fresh = request.headers.get("x-liquidmuppets-fresh") == "1"

    with request.app.state.rpc_cache_lock:
        now = monotonic()
        expired = [key for key, (expires_at, _) in request.app.state.rpc_cache.items() if expires_at <= now]
        for key in expired:
            request.app.state.rpc_cache.pop(key, None)
        if cacheable and not force_fresh:
            cached = request.app.state.rpc_cache.get(cache_key)
            if cached is not None:
                return Response(content=cached[1], media_type="application/json")

        try:
            if isinstance(payload, list) and len(payload) > RPC_UPSTREAM_BATCH_SIZE:
                rows: list[object] = []
                for start in range(0, len(payload), RPC_UPSTREAM_BATCH_SIZE):
                    chunk = payload[start : start + RPC_UPSTREAM_BATCH_SIZE]
                    upstream, active_index = _post_rpc_with_failover(
                        request.app.state.rpc_client,
                        request.app.state.rpc_urls,
                        request.app.state.rpc_active_index,
                        chunk,
                    )
                    request.app.state.rpc_active_index = active_index
                    body = upstream.json()
                    if not isinstance(body, list):
                        raise ValueError("upstream returned a non-batch response")
                    rows.extend(body)
                content = json.dumps(rows, separators=(",", ":")).encode()
            else:
                upstream, active_index = _post_rpc_with_failover(
                    request.app.state.rpc_client,
                    request.app.state.rpc_urls,
                    request.app.state.rpc_active_index,
                    payload,
                )
                request.app.state.rpc_active_index = active_index
                content = upstream.content
            if cacheable and _rpc_content_succeeded(content):
                request.app.state.rpc_cache[cache_key] = (monotonic() + RPC_CACHE_SECONDS, content)
            return Response(content=content, media_type="application/json")
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=502, detail="upstream RPC request failed") from error


def _post_rpc_with_retries(client: httpx.Client, url: str, payload: Any) -> httpx.Response:
    last_error: httpx.HTTPError | None = None
    for attempt, delay in enumerate(RPC_RETRY_DELAYS):
        if delay:
            sleep(delay)
        try:
            response = client.post(url, json=payload)
            if response.status_code in RPC_RETRY_STATUS_CODES and attempt < len(RPC_RETRY_DELAYS) - 1:
                continue
            response.raise_for_status()
            return response
        except httpx.HTTPError as error:
            last_error = error
            if not isinstance(error, httpx.RequestError) or attempt == len(RPC_RETRY_DELAYS) - 1:
                break
    if last_error is not None:
        raise last_error
    raise RuntimeError("RPC retry loop did not execute")


def _post_rpc_with_failover(
    client: httpx.Client,
    urls: tuple[str, ...],
    active_index: int,
    payload: Any,
) -> tuple[httpx.Response, int]:
    ordered = [active_index, *(index for index in range(len(urls)) if index != active_index)]
    last_error: Exception | None = None
    retryable_response: httpx.Response | None = None
    for index in ordered:
        try:
            response = _post_rpc_with_retries(client, urls[index], payload)
        except httpx.HTTPError as error:
            last_error = error
            continue
        if _rpc_content_retryable(response.content):
            retryable_response = response
            continue
        return response, index
    if last_error is not None:
        raise last_error
    if retryable_response is not None:
        return retryable_response, active_index
    raise RuntimeError("RPC failover loop did not execute")


def _rpc_content_retryable(content: bytes) -> bool:
    try:
        body = json.loads(content)
    except (UnicodeDecodeError, ValueError):
        return False
    rows = body if isinstance(body, list) else [body]
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("error"), dict):
            continue
        error = row["error"]
        code = error.get("code")
        message = str(error.get("message", "")).lower()
        if code in {-32005, -32016, -32603} or any(
            marker in message for marker in ("rate limit", "too many", "timeout", "unavailable", "gateway")
        ):
            return True
    return False


def _rpc_content_succeeded(content: bytes) -> bool:
    try:
        body = json.loads(content)
    except (UnicodeDecodeError, ValueError):
        return False
    rows = body if isinstance(body, list) else [body]
    return bool(rows) and all(isinstance(row, dict) and "error" not in row for row in rows)
