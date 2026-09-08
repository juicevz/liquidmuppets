from __future__ import annotations

from dataclasses import dataclass
from os import getenv
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    value = getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in getenv(name, "").split(",") if value.strip())


@dataclass(frozen=True)
class Settings:
    app_env: str = getenv("APP_ENV", "development")
    chain_id: int = int(getenv("CHAIN_ID", "4663"))
    chain_name: str = getenv("CHAIN_NAME", "Robinhood Chain")
    rpc_url: str = getenv("RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
    rpc_fallback_urls: tuple[str, ...] = _csv("RPC_FALLBACK_URLS")
    browser_rpc_url: str = getenv("BROWSER_RPC_URL", "/api/v1/rpc")
    explorer_url: str = getenv("EXPLORER_URL", "https://robinhoodchain.blockscout.com")
    public_base_url: str = getenv("PUBLIC_BASE_URL", "https://liquidmuppets.io").rstrip("/")
    deployment_block: int = int(getenv("DEPLOYMENT_BLOCK", "0"))
    factory_version: int = int(getenv("FACTORY_VERSION", "1"))
    factory_address: str = getenv("FACTORY_ADDRESS", "")
    legacy_factory_address: str = getenv("LEGACY_FACTORY_ADDRESS", "")
    legacy_agent_count: int = int(getenv("LEGACY_AGENT_COUNT", "0"))
    policy_executor_address: str = getenv("POLICY_EXECUTOR_ADDRESS", "")
    key_marketplace_address: str = getenv("KEY_MARKETPLACE_ADDRESS", "")
    legacy_key_marketplace_address: str = getenv("LEGACY_KEY_MARKETPLACE_ADDRESS", "")
    fee_rwa_reserve_address: str = getenv("FEE_RWA_RESERVE_ADDRESS", "")
    revenue_router_address: str = getenv("REVENUE_ROUTER_ADDRESS", "")
    agent_bond_address: str = getenv("AGENT_BOND_ADDRESS", "")
    buyback_vault_address: str = getenv("BUYBACK_VAULT_ADDRESS", "")
    buyback_executor_address: str = getenv("BUYBACK_EXECUTOR_ADDRESS", "")
    universal_router_address: str = getenv(
        "UNIVERSAL_ROUTER_ADDRESS", "0x8876789976DeCBFCBbBE364623c63652db8C0904"
    )
    revenue_deployment_block: int = int(getenv("REVENUE_DEPLOYMENT_BLOCK", "0"))
    pons_fee_policy_address: str = getenv(
        "PONS_FEE_POLICY_ADDRESS", "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"
    )
    pons_fee_escrow_address: str = getenv(
        "PONS_FEE_ESCROW_ADDRESS", "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e"
    )
    pons_curve_address: str = getenv("PONS_CURVE_ADDRESS", "0x006A81aCf6087Efd637461f3068a5160611A477B")
    pons_pool_id: str = getenv(
        "PONS_POOL_ID", "0x917d90894a647c3cb4f7bad482a1b3276f643f69a36278371acbf4afaa16b128"
    )
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
    muppets_token_address: str = getenv("MUPPETS_TOKEN_ADDRESS", "")
    muppets_token_symbol: str = getenv("MUPPETS_TOKEN_SYMBOL", "MUPPETS")
    muppets_token_minimum: int = int(getenv("MUPPETS_TOKEN_MINIMUM", "15000"))
    keeper_private_key: str = getenv("KEEPER_PRIVATE_KEY", "")
    keeper_expected_address: str = getenv("KEEPER_EXPECTED_ADDRESS", "")
    allow_public_keeper_run: bool = _bool("ALLOW_PUBLIC_KEEPER_RUN", False)
    auto_keeper_enabled: bool = _bool("AUTO_KEEPER_ENABLED", False)
    auto_keeper_interval_seconds: int = int(getenv("AUTO_KEEPER_INTERVAL_SECONDS", "60"))
    performance_checkpoint_interval_seconds: int = int(getenv("PERFORMANCE_CHECKPOINT_INTERVAL_SECONDS", "300"))
    activity_refresh_interval_seconds: int = int(getenv("ACTIVITY_REFRESH_INTERVAL_SECONDS", "60"))
    activity_retry_interval_seconds: int = int(getenv("ACTIVITY_RETRY_INTERVAL_SECONDS", "15"))
    activity_stale_after_seconds: int = int(getenv("ACTIVITY_STALE_AFTER_SECONDS", "300"))
    activity_block_chunk_size: int = int(getenv("ACTIVITY_BLOCK_CHUNK_SIZE", "50000"))
    activity_chunk_delay_seconds: float = float(getenv("ACTIVITY_CHUNK_DELAY_SECONDS", "0.15"))
    activity_confirmation_blocks: int = int(getenv("ACTIVITY_CONFIRMATION_BLOCKS", "2"))
    activity_reorg_window_blocks: int = int(getenv("ACTIVITY_REORG_WINDOW_BLOCKS", "12"))
    database_path: Path = Path(getenv("DATABASE_PATH", "/tmp/liquidmuppets.sqlite3"))
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in getenv("CORS_ORIGINS", "http://localhost:5173,https://liquidmuppets.io").split(",")
        if origin.strip()
    )

    @property
    def rpc_urls(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys((self.rpc_url, *self.rpc_fallback_urls)))


settings = Settings()
