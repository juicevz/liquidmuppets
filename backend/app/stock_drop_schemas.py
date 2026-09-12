from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.services.stock_drop_manifest import Allocation, Exclusion, Hash32, Raw

Wallet = Annotated[str, Field(pattern=r"^0x[a-fA-F0-9]{40}$")]


class StockDropAllocation(Allocation):
    claimed: bool


class FundedStockDrop(BaseModel):
    id: Raw
    status: Literal["funded"]
    reason: None = None
    token: Wallet
    symbol: str
    decimals: Literal[18]
    funded_raw: Raw
    claimed_raw: Raw
    remaining_raw: Raw
    root: Hash32
    manifest_hash: Hash32
    manifest_url: str
    snapshot_block: int
    snapshot_hash: Hash32
    eligible_wallets: int
    total_units: Raw
    exclusions: list[Exclusion]
    allocation: StockDropAllocation | None


class UnavailableStockDrop(BaseModel):
    id: Raw
    status: Literal["unavailable"]
    reason: str
    allocation: None = None


class StockDropResponse(BaseModel):
    status: Literal["not_configured", "unavailable", "available"]
    reason: str | None
    chain_id: int
    rpc_url: str
    explorer_url: str
    contract: Wallet | None
    unit_raw: Raw
    block_number: int | None
    total_drops: int | None
    next_before: int | None
    wallet: Wallet | None
    drops: list[Annotated[FundedStockDrop | UnavailableStockDrop, Field(discriminator="status")]]
