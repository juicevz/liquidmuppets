import { describe, expect, it } from 'vitest'
import type { MarketplacePerformanceSummary, PulseItem } from './api'
import { alertIsUnread, buildMonitorAlerts, summaryNeedsAttention } from './monitor'

function performance(overrides: Partial<MarketplacePerformanceSummary> = {}): MarketplacePerformanceSummary {
  return {
    agent: {
      id: 1,
      name: 'range fox',
      creator: '0x1111111111111111111111111111111111111111',
      pet_id: 3,
      task_id: 1,
      task_label: 'ETH range',
      created_at: 1,
      vault: '0x2222222222222222222222222222222222222222',
      key: '0x3333333333333333333333333333333333333333',
    },
    tracking_started_at: '2026-09-06T10:00:00Z',
    captured_at: '2026-09-06T11:00:00Z',
    checkpoint_count: 2,
    market_observed_at: '2026-09-06T11:00:00Z',
    market_refresh_failed_at: null,
    asset: { address: '0x4444444444444444444444444444444444444444', symbol: 'WETH', decimals: 18 },
    current: {
      block_number: 1,
      timestamp: '2026-09-06T11:00:00Z',
      total_assets_raw: '100',
      total_supply_raw: '100',
      share_price_raw: '1',
      idle_assets_raw: '15',
      deployed_assets_raw: '85',
      deposits_raw: '0',
      withdrawals_raw: '0',
      flow_adjusted_change_raw: '0',
      flow_adjusted_change_bps: 0,
    },
    change_method: { id: 'cash_flow_adjusted_since_tracking', label: 'adjusted', explanation: 'recorded' },
    market: {
      task_id: 1,
      route: 'route',
      asset: { address: '0x4444444444444444444444444444444444444444', symbol: 'WETH' },
      adapter: '0x5555555555555555555555555555555555555555',
      venue: 'Uniswap V3 via EZManager',
      pair: 'WETH / USDG',
      pool: '0x6666666666666666666666666666666666666666',
      range: {
        status: 'open', position_key: '0x01', lower_tick: -10, upper_tick: 10, current_tick: 0,
        in_range: true, tick_spacing: 1, half_range_ticks: 10,
      },
      oracle: { status: 'value_available_timestamp_not_exposed', updated_at: null, age_seconds: null, detail: 'timestamp not exposed' },
      health: { status: 'healthy', detail: 'checks passed', metrics: {} },
    },
    keeper: null,
    key_market: {
      status: 'available', detail: 'separate', symbol: 'FOX', supply_raw: '100', total_bound_raw: '0',
      listed_raw: '0', floor_wei: null, top_bid_wei: null, fee_bps: 300,
    },
    ...overrides,
  }
}

function pulse(overrides: Partial<PulseItem> = {}): PulseItem {
  return {
    id: 'keeper-1', source: 'keeper', category: 'keeper', facets: ['keeper'], timestamp: '2026-09-06T11:02:00Z',
    action: 'keeper held', actor: null, actor_handle: null, creator: null, creator_handle: null, agent_id: 1,
    agent_name: 'range fox', key_symbol: 'FOX', quantity: null, value: null, value_symbol: null, direction: 'neutral',
    reason: 'cooldown active', status: 'auto-skipped', tx_hash: null, block_number: null, ...overrides,
  }
}

describe('monitor alert derivation', () => {
  it('keeps timestamp-not-exposed honest without calling it stale', () => {
    const summary = performance()
    expect(summaryNeedsAttention(summary)).toBe(false)
    expect(buildMonitorAlerts([summary], [], [1])).toEqual([])
  })

  it('creates followed range, evidence-delay, and keeper alerts with receipt boundaries', () => {
    const summary = performance({
      market_refresh_failed_at: '2026-09-06T11:03:00Z',
      market: { ...performance().market, range: { ...performance().market.range!, in_range: false, current_tick: 20 } },
    })
    const alerts = buildMonitorAlerts([summary], [pulse()], [1])
    expect(alerts.map((alert) => alert.category)).toEqual(['evidence delay', 'keeper', 'range'])
    expect(alerts.every((alert) => alert.txHash === null)).toBe(true)
    expect(summaryNeedsAttention(summary)).toBe(true)
  })

  it('filters unrelated Muppets but includes global reserve purchases', () => {
    const reserve = pulse({
      id: 'reserve-1', source: 'chain', category: 'reserve', facets: ['reserve'], agent_id: null, agent_name: null,
      action: 'purchased AAPL', tx_hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    const alerts = buildMonitorAlerts([performance()], [pulse({ agent_id: 9 }), reserve], [1])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].category).toBe('Stock Token reserve')
    expect(alerts[0].txHash).toBe(reserve.tx_hash)
  })

  it('computes unread state from the local read-through boundary', () => {
    const alert = buildMonitorAlerts([], [pulse()], [1])[0]
    expect(alertIsUnread(alert, null)).toBe(true)
    expect(alertIsUnread(alert, '2026-09-06T11:01:59Z')).toBe(true)
    expect(alertIsUnread(alert, '2026-09-06T11:02:00Z')).toBe(false)
  })
})
