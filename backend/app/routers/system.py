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
RPC_RETRY_DELAYS = (0.0, 0.15, 0.4)
RPC_CACHE_SECONDS = 15


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
        latest_block=block,
        contracts_configured=chain.contracts_configured,
        keeper_configured=chain.keeper_configured,
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
        "factory": settings.factory_address or None,
        "policyExecutor": settings.policy_executor_address or None,
        "keyMarketplace": settings.key_marketplace_address or None,
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
        "mode": "testnet" if settings.chain_id == 46630 else "mainnet",
    }


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

        last_error: httpx.HTTPError | None = None
        for attempt, delay in enumerate(RPC_RETRY_DELAYS):
            if delay:
                sleep(delay)
            try:
                upstream = request.app.state.rpc_client.post(request.app.state.settings.rpc_url, json=payload)
                if upstream.status_code in RPC_RETRY_STATUS_CODES and attempt < len(RPC_RETRY_DELAYS) - 1:
                    continue
                upstream.raise_for_status()
                if cacheable and _rpc_response_succeeded(upstream):
                    request.app.state.rpc_cache[cache_key] = (monotonic() + RPC_CACHE_SECONDS, upstream.content)
                return Response(content=upstream.content, media_type="application/json")
            except httpx.HTTPError as error:
                last_error = error
                if not isinstance(error, httpx.RequestError) or attempt == len(RPC_RETRY_DELAYS) - 1:
                    break

    raise HTTPException(status_code=502, detail="upstream RPC request failed") from last_error


def _rpc_response_succeeded(response: httpx.Response) -> bool:
    try:
        body = response.json()
    except ValueError:
        return False
    rows = body if isinstance(body, list) else [body]
    return bool(rows) and all(isinstance(row, dict) and "error" not in row for row in rows)
