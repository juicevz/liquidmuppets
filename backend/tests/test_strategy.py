from app.schemas import PoolCandidate, StrategyPreviewRequest
from app.services.strategy import preview_strategy


def test_stable_strategy_allocates_only_to_safe_candidate() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(
            task_id=0,
            total_assets=1_000_000,
            idle_assets=1_000_000,
            deployed_assets=0,
            candidates=[
                PoolCandidate(
                    id="morpho-usdg-a",
                    venue="Morpho Blue",
                    allowed=True,
                    liquidity_usd=2_000_000,
                    estimated_net_apy_bps=240,
                    oracle_age_seconds=30,
                    utilization_bps=7_800,
                )
            ],
        )
    )
    assert response.action == "allocate"
    assert response.amount == 900_000
    assert response.selected_pool_id == "morpho-usdg-a"


def test_launch_strategy_stages_only_ten_percent_in_reserve() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(
            task_id=2,
            total_assets=1_000_000,
            idle_assets=1_000_000,
            deployed_assets=0,
            candidates=[
                PoolCandidate(
                    id="fresh-pool",
                    venue="Uniswap",
                    allowed=True,
                    liquidity_usd=20_000,
                    estimated_net_apy_bps=5_000,
                    oracle_age_seconds=10,
                    pool_age_seconds=60,
                    volume_24h_usd=2_000,
                )
            ],
        )
    )
    assert response.action == "allocate"
    assert response.amount == 100_000
    assert response.selected_pool_id == "launch-reserve"
    assert response.candidates[0].accepted is False


def test_accounting_mismatch_fails_closed() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(task_id=0, total_assets=100, idle_assets=80, deployed_assets=30)
    )
    assert response.action == "hold"
    assert response.reason == "vault accounting is inconsistent"


def test_launch_strategy_can_stage_without_a_pool_candidate() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(task_id=2, total_assets=1_000_000, idle_assets=1_000_000, deployed_assets=0)
    )
    assert response.action == "allocate"
    assert response.amount == 100_000
    assert response.target_deployed_assets == 100_000
    assert response.selected_pool_id == "launch-reserve"


def test_eth_range_uses_the_live_fixed_route_without_candidates() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(task_id=1, total_assets=1_000_000, idle_assets=1_000_000, deployed_assets=0)
    )
    assert response.action == "allocate"
    assert response.amount == 850_000
    assert response.selected_pool_id == "ezmanager-weth-usdg-100"


def test_stable_strategy_rejects_market_below_five_times_vault_value() -> None:
    response = preview_strategy(
        StrategyPreviewRequest(
            task_id=0,
            total_assets=1_000_000,
            idle_assets=1_000_000,
            deployed_assets=0,
            vault_value_usd=500_000,
            candidates=[
                PoolCandidate(
                    id="thin-market",
                    venue="Morpho Blue",
                    allowed=True,
                    liquidity_usd=2_000_000,
                    estimated_net_apy_bps=240,
                    oracle_age_seconds=30,
                    utilization_bps=7_800,
                )
            ],
        )
    )
    assert response.action == "hold"
    assert response.candidates[0].reasons == ["market liquidity is below 5x the vault value"]
