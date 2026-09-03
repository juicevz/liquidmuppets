from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, settings
from app.database import Database, KeeperRunRecord
from app.routers import activity, keeper, profiles, strategies, system
from app.services.activity import ActivityService
from app.services.chain import ChainService


def create_app(app_settings: Settings = settings) -> FastAPI:
    database = Database(app_settings.database_path)
    chain = ChainService(app_settings)
    activity_service = ActivityService(app_settings)

    @asynccontextmanager
    async def lifespan(live_app: FastAPI) -> AsyncIterator[None]:
        database.initialize()
        rpc_client = httpx.Client(timeout=8)
        live_app.state.rpc_client = rpc_client
        stop = asyncio.Event()
        keeper_task = None
        if app_settings.auto_keeper_enabled and chain.keeper_configured:
            keeper_task = asyncio.create_task(_auto_keeper_loop(chain, database, app_settings, stop))
        try:
            yield
        finally:
            stop.set()
            if keeper_task is not None:
                await keeper_task
            rpc_client.close()

    app = FastAPI(
        title="LiquidMuppets Strategy API",
        version="0.2.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = database
    app.state.chain = chain
    app.state.activity = activity_service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(system.router, prefix="/api/v1")
    app.include_router(strategies.router, prefix="/api/v1")
    app.include_router(keeper.router, prefix="/api/v1")
    app.include_router(profiles.router, prefix="/api/v1")
    app.include_router(activity.router, prefix="/api/v1")
    return app


app = create_app()


async def _auto_keeper_loop(
    chain: ChainService,
    database: Database,
    app_settings: Settings,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        for vault in await asyncio.to_thread(chain.list_vaults):
            try:
                state, preview, tx_hash, status = await asyncio.to_thread(chain.run_keeper, vault, public_request=False)
            except Exception:
                continue
            database.add_keeper_run(
                KeeperRunRecord(
                    vault=state.vault,
                    task_id=state.task_id,
                    action=preview.action,
                    amount=str(preview.amount),
                    reason=preview.reason,
                    status=f"auto-{status}",
                    tx_hash=tx_hash,
                )
            )
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(15, app_settings.auto_keeper_interval_seconds))
        except TimeoutError:
            continue
