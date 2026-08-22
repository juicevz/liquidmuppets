from __future__ import annotations

from dataclasses import dataclass
from os import getenv
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    value = getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_env: str = getenv("APP_ENV", "development")
    chain_id: int = int(getenv("CHAIN_ID", "4663"))
    chain_name: str = getenv("CHAIN_NAME", "Robinhood Chain")
    rpc_url: str = getenv("RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
    browser_rpc_url: str = getenv("BROWSER_RPC_URL", "/api/v1/rpc")
    explorer_url: str = getenv("EXPLORER_URL", "https://robinhoodchain.blockscout.com")
    deployment_block: int = int(getenv("DEPLOYMENT_BLOCK", "0"))
    factory_address: str = getenv("FACTORY_ADDRESS", "")
    policy_executor_address: str = getenv("POLICY_EXECUTOR_ADDRESS", "")
    key_marketplace_address: str = getenv("KEY_MARKETPLACE_ADDRESS", "")
    test_usdg_address: str = getenv("TEST_USDG_ADDRESS", "")
    test_weth_address: str = getenv("TEST_WETH_ADDRESS", "")
    stable_pool_address: str = getenv("STABLE_POOL_ADDRESS", "")
    eth_pool_address: str = getenv("ETH_POOL_ADDRESS", "")
    launch_pool_address: str = getenv("LAUNCH_POOL_ADDRESS", "")
    usdg_address: str = getenv("USDG_ADDRESS", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")
    morpho_address: str = getenv("MORPHO_ADDRESS", "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010")
    stable_market_id: str = getenv(
        "STABLE_MARKET_ID", "0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6"
    )
    stable_adapter_address: str = getenv("STABLE_ADAPTER_ADDRESS", "")
    range_adapter_address: str = getenv("RANGE_ADAPTER_ADDRESS", "")
    launch_reserve_adapter_address: str = getenv("LAUNCH_RESERVE_ADAPTER_ADDRESS", "")
    weth_address: str = getenv("WETH_ADDRESS", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")
    ez_wrapper_address: str = getenv("EZ_WRAPPER_ADDRESS", "0x6F81790Ebac25497be379Dc66143fb298663Ae11")
    keeper_private_key: str = getenv("KEEPER_PRIVATE_KEY", "")
    allow_public_keeper_run: bool = _bool("ALLOW_PUBLIC_KEEPER_RUN", False)
    auto_keeper_enabled: bool = _bool("AUTO_KEEPER_ENABLED", False)
    auto_keeper_interval_seconds: int = int(getenv("AUTO_KEEPER_INTERVAL_SECONDS", "60"))
    database_path: Path = Path(getenv("DATABASE_PATH", "/tmp/liquidmuppets.sqlite3"))
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in getenv("CORS_ORIGINS", "http://localhost:5173,https://liquidmuppets.io").split(",")
        if origin.strip()
    )


settings = Settings()
