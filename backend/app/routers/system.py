from __future__ import annotations

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

    try:
        upstream = httpx.post(request.app.state.settings.rpc_url, json=payload, timeout=8)
        upstream.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="upstream RPC request failed") from error
    return Response(content=upstream.content, media_type="application/json")
