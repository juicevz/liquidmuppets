from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import Lock

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, settings
from app.database import Database, KeeperRunRecord
from app.routers import (
    access,
    activity,
    keeper,
    performance,
    profiles,
    proofs,
    public,
    radar,
    revenue,
    stock_drops,
    strategies,
    system,
)
from app.services.activity import ActivityService
from app.services.chain import ChainService
from app.services.performance import PerformanceService
from app.services.proofs import PROOF_BOUNDARY, ProofService
from app.services.public_data import PublicDataService
from app.services.revenue import RevenueService
from app.services.stock_drops import StockDropService
from app.services.token_gate import TokenGateService

logger = logging.getLogger(__name__)


def create_app(app_settings: Settings = settings) -> FastAPI:
    database = Database(app_settings.database_path)
    chain = ChainService(app_settings, database)
    activity_service = ActivityService(app_settings, database)
    token_gate = TokenGateService(app_settings, chain.web3)
    performance_service = PerformanceService(app_settings, database, chain)
    public_data_service = PublicDataService(app_settings, database, activity_service, token_gate)
    proof_service = ProofService(app_settings, database, activity_service, chain)
    revenue_service = RevenueService(app_settings, chain.web3)
    stock_drop_service = StockDropService(app_settings, chain.web3)

    @asynccontextmanager
    async def lifespan(live_app: FastAPI) -> AsyncIterator[None]:
        database.initialize()
        chain.restore_persistent_state()
        activity_service.restore_persistent_state()
        rpc_client = httpx.Client(timeout=8)
        live_app.state.rpc_client = rpc_client
        live_app.state.rpc_urls = app_settings.rpc_urls
        live_app.state.rpc_active_index = 0
        live_app.state.rpc_cache = {}
        live_app.state.rpc_cache_lock = Lock()
        stop = asyncio.Event()
        keeper_task = None
        performance_task = None
        activity_task = None
        proof_task = None
        if app_settings.factory_address:
            performance_task = asyncio.create_task(_performance_loop(performance_service, app_settings, stop))
            activity_task = asyncio.create_task(_activity_loop(activity_service, app_settings, stop))
            proof_task = asyncio.create_task(_proof_loop(proof_service, app_settings, stop))
        if (
            app_settings.auto_keeper_enabled
            and app_settings.keeper_private_key
            and app_settings.keeper_expected_address
        ):
            keeper_task = asyncio.create_task(_auto_keeper_loop(chain, database, app_settings, stop))
        try:
            yield
        finally:
            stop.set()
            if keeper_task is not None:
                await keeper_task
            if performance_task is not None:
                await performance_task
            if activity_task is not None:
                await activity_task
            if proof_task is not None:
                await proof_task
            rpc_client.close()

    app = FastAPI(
        title="LiquidMuppets Strategy API",
        version="0.9.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = database
    app.state.chain = chain
    app.state.activity = activity_service
    app.state.performance = performance_service
    app.state.public_data = public_data_service
    app.state.token_gate = token_gate
    app.state.proofs = proof_service
    app.state.proofs_boundary = PROOF_BOUNDARY
    app.state.revenue = revenue_service
    app.state.stock_drops = stock_drop_service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-LiquidMuppets-Fresh"],
    )
    app.include_router(system.router, prefix="/api/v1")
    app.include_router(access.router, prefix="/api/v1")
    app.include_router(strategies.router, prefix="/api/v1")
    app.include_router(keeper.router, prefix="/api/v1")
    app.include_router(profiles.router, prefix="/api/v1")
    app.include_router(activity.router, prefix="/api/v1")
    app.include_router(performance.router, prefix="/api/v1")
    app.include_router(radar.router, prefix="/api/v1")
    app.include_router(public.router, prefix="/api/v1")
    app.include_router(revenue.router, prefix="/api/v1")
    app.include_router(stock_drops.router, prefix="/api/v1")
    app.include_router(proofs.api_router, prefix="/api/v1")
    app.include_router(proofs.share_router)
    return app


app = create_app()


async def _activity_loop(
    activity_service: ActivityService,
    app_settings: Settings,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(activity_service.refresh)
        except Exception as error:
            logger.warning("scheduled activity indexing failed: %s", type(error).__name__)
        try:
            await asyncio.wait_for(
                stop.wait(),
                timeout=max(15, app_settings.activity_refresh_interval_seconds),
            )
        except TimeoutError:
            continue


async def _performance_loop(
    performance_service: PerformanceService,
    app_settings: Settings,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(performance_service.capture_all)
        except Exception as error:
            logger.warning("scheduled performance capture failed: %s", type(error).__name__)
        try:
            await asyncio.wait_for(
                stop.wait(),
                timeout=max(30, app_settings.performance_checkpoint_interval_seconds),
            )
        except TimeoutError:
            continue


async def _proof_loop(
    proof_service: ProofService,
    app_settings: Settings,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(proof_service.refresh)
        except Exception as error:
            logger.warning("scheduled proof materialization failed: %s", type(error).__name__)
        try:
            await asyncio.wait_for(
                stop.wait(),
                timeout=max(30, app_settings.activity_refresh_interval_seconds),
            )
        except TimeoutError:
            continue


async def _auto_keeper_loop(
    chain: ChainService,
    database: Database,
    app_settings: Settings,
    stop: asyncio.Event,
) -> None:
    while not stop.is_set():
        try:
            vaults = await asyncio.to_thread(chain.list_vaults)
        except Exception as error:
            logger.warning("scheduled keeper could not list vaults: %s", type(error).__name__)
            vaults = []
        for vault in vaults:
            try:
                state, preview, tx_hash, status = await asyncio.to_thread(chain.run_keeper, vault, public_request=False)
            except Exception as error:
                logger.warning("scheduled vault cycle skipped for %s: %s", vault, type(error).__name__)
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
        if app_settings.fee_rwa_reserve_address:
            try:
                amount, tx_hash, status, reason = await asyncio.to_thread(chain.run_rwa_cycle, public_request=False)
            except Exception as error:
                logger.warning("scheduled RWA cycle skipped: %s", type(error).__name__)
            else:
                database.add_keeper_run(
                    KeeperRunRecord(
                        vault=app_settings.fee_rwa_reserve_address,
                        task_id=3,
                        action="rwa-purchase" if tx_hash is not None else "hold",
                        amount=str(amount),
                        reason=reason,
                        status=f"auto-{status}",
                        tx_hash=tx_hash,
                    )
                )
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(15, app_settings.auto_keeper_interval_seconds))
        except TimeoutError:
            continue
