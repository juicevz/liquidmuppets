import { useCallback, useEffect, useMemo, useState } from 'react'
import { FollowButton } from '../components/FollowButton'
import { Icon } from '../components/Icon'
import { getPet } from '../data/pets'
import { useWatchlist } from '../hooks/useWatchlist'
import {
  fetchMarketRadar,
  fetchMarketplacePerformance,
  fetchSystemPulse,
  type MarketRadarResponse,
  type MarketRadarRoute,
  type MarketplacePerformanceSummary,
  type PulseResponse,
  type RadarMetric,
} from '../lib/api'
import { alertIsUnread, buildMonitorAlerts, summaryNeedsAttention, type MonitorAlert } from '../lib/monitor'
import { performancePath } from '../lib/navigation'

type MonitorTab = 'watchlist' | 'alerts' | 'radar'

export function MonitorPage() {
  const { state, markAlertsRead } = useWatchlist()
  const [tab, setTab] = useState<MonitorTab>('watchlist')
  const [summaries, setSummaries] = useState<MarketplacePerformanceSummary[]>([])
  const [pulse, setPulse] = useState<PulseResponse | null>(null)
  const [radar, setRadar] = useState<MarketRadarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)

  const load = useCallback(async () => {
    const [performanceResult, pulseResult, radarResult] = await Promise.allSettled([
      fetchMarketplacePerformance(),
      fetchSystemPulse({ limit: 200 }),
      fetchMarketRadar(),
    ])
    const failures: string[] = []
    if (performanceResult.status === 'fulfilled') setSummaries(performanceResult.value.items)
    else failures.push('watchlist records')
    if (pulseResult.status === 'fulfilled') setPulse(pulseResult.value)
    else failures.push('alert receipts')
    if (radarResult.status === 'fulfilled') setRadar(radarResult.value)
    else failures.push('Market Radar')
    setErrors(failures)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load, refreshToken])

  const followed = useMemo(
    () => summaries.filter((summary) => state.agentIds.includes(summary.agent.id)),
    [state.agentIds, summaries],
  )
  const alerts = useMemo(
    () => buildMonitorAlerts(summaries, pulse?.items ?? [], state.agentIds),
    [pulse?.items, state.agentIds, summaries],
  )
  const unread = alerts.filter((alert) => alertIsUnread(alert, state.alertsReadThrough)).length
  const attention = followed.filter(summaryNeedsAttention).length
  const missingRecords = state.agentIds.filter((id) => !summaries.some((summary) => summary.agent.id === id))

  return (
    <div className="app-page monitor-page">
      <section className="monitor-heading">
        <div>
          <span className="monitor-eyebrow"><i />browser-local monitor</span>
          <h1>Watchlist.</h1>
          <p>Follow Muppets, read their evidence alerts, and inspect approved routes without connecting a wallet.</p>
        </div>
        <div className="monitor-summary" aria-label="Watchlist summary">
          <span><small>followed</small><strong>{state.agentIds.length}</strong></span>
          <span><small>needs attention</small><strong className={attention ? 'attention' : ''}>{attention}</strong></span>
          <span><small>unread alerts</small><strong className={unread ? 'unread' : ''}>{unread}</strong></span>
        </div>
      </section>

      <section className="monitor-boundary-note">
        <Icon name="shield" />
        <div>
          <strong>Your list and read state stay in this browser.</strong>
          <p>No wallet signature, account, or contract change is required. Clearing this browser's site data resets the list.</p>
        </div>
        <button type="button" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}>
          <Icon name="spark" />{loading ? 'Reading' : 'Refresh'}
        </button>
      </section>

      {errors.length > 0 && (
        <div className="monitor-warning" role="status">
          <Icon name="alert" />Some records are reconnecting: {errors.join(', ')}. The last successful data remains visible.
        </div>
      )}

      <nav className="monitor-tabs" aria-label="Monitor sections">
        <button type="button" className={tab === 'watchlist' ? 'active' : ''} aria-current={tab === 'watchlist' ? 'page' : undefined} onClick={() => setTab('watchlist')}>
          <Icon name="bookmark" />Watchlist <span>{state.agentIds.length}</span>
        </button>
        <button type="button" className={tab === 'alerts' ? 'active' : ''} aria-current={tab === 'alerts' ? 'page' : undefined} onClick={() => setTab('alerts')}>
          <Icon name="bell" />Alerts <span>{unread}</span>
        </button>
        <button type="button" className={tab === 'radar' ? 'active' : ''} aria-current={tab === 'radar' ? 'page' : undefined} onClick={() => setTab('radar')}>
          <Icon name="search" />Market Radar <em>beta</em>
        </button>
      </nav>

      {tab === 'watchlist' && (
        <WatchlistPanel summaries={followed} missingRecords={missingRecords} loading={loading} />
      )}
      {tab === 'alerts' && (
        <AlertsPanel
          alerts={alerts}
          explorerUrl={pulse?.explorer_url ?? radar?.explorer_url ?? ''}
          readThrough={state.alertsReadThrough}
          onMarkAllRead={() => markAlertsRead()}
        />
      )}
      {tab === 'radar' && <RadarPanel radar={radar} loading={loading} />}
    </div>
  )
}

function WatchlistPanel({
  summaries,
  missingRecords,
  loading,
}: {
  summaries: MarketplacePerformanceSummary[]
  missingRecords: number[]
  loading: boolean
}) {
  if (loading && summaries.length === 0 && missingRecords.length === 0) {
    return <div className="monitor-state"><Icon name="clock" />Reading recorded Muppet evidence.</div>
  }
  if (summaries.length === 0 && missingRecords.length === 0) {
    return (
      <section className="monitor-empty">
        <Icon name="bookmark" />
        <h2>Your watchlist is empty.</h2>
        <p>Follow a Muppet from the marketplace or any public performance page. No wallet is needed.</p>
        <a href="/app">Browse Muppets <Icon name="arrow" /></a>
      </section>
    )
  }

  return (
    <section className="monitor-ledger" aria-labelledby="watchlist-ledger-title">
      <header>
        <div><small>followed records</small><h2 id="watchlist-ledger-title">Muppet evidence</h2></div>
        <span>cash-flow adjusted · native assets only</span>
      </header>
      <div className="watchlist-table-wrap">
        <div className="watchlist-table" role="table" aria-label="Followed Muppet evidence">
          <div className="watchlist-table-head" role="row">
            <span role="columnheader">Muppet / asset</span>
            <span role="columnheader">since tracking</span>
            <span role="columnheader">adjusted change</span>
            <span role="columnheader">deployed</span>
            <span role="columnheader">route / health</span>
            <span role="columnheader">oracle</span>
            <span role="columnheader">last keeper</span>
            <span role="columnheader">controls</span>
          </div>
          {summaries.map((summary) => <WatchlistRow summary={summary} key={summary.agent.id} />)}
        </div>
      </div>
      {missingRecords.length > 0 && (
        <p className="monitor-missing">Waiting for recorded summaries for Muppet {missingRecords.map((id) => `#${id}`).join(', ')}.</p>
      )}
      <footer><Icon name="shield" />Every value keeps its original asset and observation window. No cross-asset ranking or annualized return is calculated.</footer>
    </section>
  )
}

function WatchlistRow({ summary }: { summary: MarketplacePerformanceSummary }) {
  const pet = getPet(summary.agent.pet_id)
  const needsAttention = summaryNeedsAttention(summary)
  return (
    <div className={`watchlist-row${needsAttention ? ' needs-attention' : ''}`} role="row">
      <span className="watchlist-agent" role="cell">
        <img src={pet.portrait} alt="" />
        <span><strong>{summary.agent.name}</strong><small>{summary.asset.symbol} · Muppet #{summary.agent.id}</small></span>
      </span>
      <span className="watchlist-value" role="cell"><strong>{formatUtc(summary.tracking_started_at)}</strong><small>{summary.checkpoint_count} checkpoints</small></span>
      <span className={`watchlist-value ${toneForBps(summary.current.flow_adjusted_change_bps)}`} role="cell"><strong>{formatBasisPoints(summary.current.flow_adjusted_change_bps)}</strong><small>deposits and withdrawals removed</small></span>
      <span className="watchlist-value" role="cell"><strong>{formatDeployed(summary)}</strong><small>checkpoint {formatAge(summary.captured_at)}</small></span>
      <span className="watchlist-value" role="cell"><strong className={`monitor-health health-${summary.market.health.status}`}><i />{summary.market.health.status}</strong><small>{summary.market.pair ?? summary.market.venue}</small></span>
      <span className="watchlist-value" role="cell"><strong>{oracleLabel(summary)}</strong><small>{summary.market_refresh_failed_at ? `cache from ${formatAge(summary.market_observed_at)}` : `observed ${formatAge(summary.market_observed_at)}`}</small></span>
      <span className="watchlist-value keeper" role="cell"><strong>{summary.keeper?.action ?? 'no decision'}</strong><small>{summary.keeper?.reason ?? 'nothing recorded yet'}</small></span>
      <span className="watchlist-controls" role="cell">
        <a href={performancePath(summary.agent.id)}>record <Icon name="arrow" /></a>
        <FollowButton agentId={summary.agent.id} agentName={summary.agent.name} compact />
      </span>
    </div>
  )
}

function AlertsPanel({
  alerts,
  explorerUrl,
  readThrough,
  onMarkAllRead,
}: {
  alerts: MonitorAlert[]
  explorerUrl: string
  readThrough: string | null
  onMarkAllRead: () => void
}) {
  const unread = alerts.filter((alert) => alertIsUnread(alert, readThrough)).length
  return (
    <section className="monitor-ledger alert-inbox" aria-labelledby="alert-inbox-title">
      <header>
        <div><small>browser-local inbox</small><h2 id="alert-inbox-title">Evidence alerts</h2></div>
        <button type="button" onClick={onMarkAllRead} disabled={unread === 0}><Icon name="check" />Mark all read</button>
      </header>
      <p className="alert-inbox-boundary">Health and range warnings come from recorded market observations. Actions and deposits link to receipts. Keeper holds correctly have no transaction.</p>
      {alerts.length === 0 ? (
        <div className="monitor-state"><Icon name="bell" />No matching watchlist or protocol-reserve alerts yet.</div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => {
            const isUnread = alertIsUnread(alert, readThrough)
            return (
              <article className={`monitor-alert severity-${alert.severity}${isUnread ? ' unread' : ''}`} key={alert.id}>
                <div className="alert-mark"><Icon name={alert.severity === 'critical' ? 'alert' : alert.severity === 'warning' ? 'clock' : 'receipt'} /></div>
                <div className="alert-body">
                  <header>
                    <div><span>{alert.category}</span><em>{alert.source}</em>{isUnread && <b>new</b>}</div>
                    <time dateTime={alert.timestamp} title={formatUtc(alert.timestamp)}>{formatAge(alert.timestamp)}</time>
                  </header>
                  <h3>{alert.title}</h3>
                  <p>{alert.detail}</p>
                  <footer>
                    {alert.agentId !== null
                      ? <a href={performancePath(alert.agentId)}>{alert.agentName ?? `Muppet #${alert.agentId}`} <Icon name="arrow" /></a>
                      : <span>protocol-wide reserve record</span>}
                    {alert.txHash && explorerUrl
                      ? <a href={`${explorerUrl}/tx/${alert.txHash}`} target="_blank" rel="noreferrer">receipt <Icon name="arrow" /></a>
                      : <span>{alert.source === 'market' ? 'evidence observation · no receipt' : 'no transaction signed'}</span>}
                  </footer>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function RadarPanel({ radar, loading }: { radar: MarketRadarResponse | null; loading: boolean }) {
  if (loading && !radar) return <div className="monitor-state"><Icon name="clock" />Reading recorded route evidence.</div>
  if (!radar) return <div className="monitor-state"><Icon name="alert" />Market Radar is reconnecting.</div>

  return (
    <section className="monitor-ledger radar-panel" aria-labelledby="radar-title">
      <header>
        <div><small>approved route scanner · beta</small><h2 id="radar-title">Muppet Market Radar</h2></div>
        <span>{radar.routes.filter((route) => route.status === 'live').length}/{radar.routes.length} routes live</span>
      </header>
      <div className="radar-boundary"><Icon name="shield" /><p><strong>Read-only.</strong> {radar.boundary}</p></div>
      <div className="radar-table-wrap">
        <div className="radar-table" role="table" aria-label="Approved Muppet route evidence">
          <div className="radar-table-head" role="row">
            <span role="columnheader">route / task</span>
            <span role="columnheader">exact market</span>
            <span role="columnheader">liquidity</span>
            <span role="columnheader">volume / age</span>
            <span role="columnheader">oracle</span>
            <span role="columnheader">capacity / cost limits</span>
            <span role="columnheader">status / reason</span>
          </div>
          {radar.routes.map((route) => <RadarRow route={route} explorerUrl={radar.explorer_url} key={route.id} />)}
        </div>
      </div>
      <footer><Icon name="search" />Generated {formatUtc(radar.generated_at)} from the latest recorded adapter observations. Missing fields stay missing.</footer>
    </section>
  )
}

function RadarRow({ route, explorerUrl }: { route: MarketRadarRoute; explorerUrl: string }) {
  const reference = route.pool ?? route.market_id
  return (
    <div className="radar-row" role="row">
      <span className="radar-route" role="cell"><strong>{route.task_label}</strong><small>{route.asset_symbol} · {route.route}</small></span>
      <span className="radar-value market" role="cell"><strong>{route.venue}</strong><small>{route.pair ?? 'no external pair'}</small>{reference && (route.pool ? <a href={`${explorerUrl}/address/${route.pool}`} target="_blank" rel="noreferrer">{short(reference)} <Icon name="arrow" /></a> : <code title={reference}>{short(reference)}</code>)}</span>
      <RadarMetricCell metric={route.liquidity} />
      <span className="radar-value" role="cell"><strong>{metricValue(route.volume_24h)}</strong><small>24h volume</small><strong>{metricValue(route.pool_age)}</strong><small>pool age</small></span>
      <span className="radar-value" role="cell"><strong>{radarOracleLabel(route)}</strong><small>{route.oracle.detail}</small></span>
      <span className="radar-value" role="cell"><strong>{route.capacity.value}</strong><small>{costLabel(route)}</small></span>
      <span className="radar-status-cell" role="cell"><b className={`radar-status status-${route.status}`}><i />{route.status}</b><p>{route.reason}</p><small>{route.monitored_muppets} monitored · {route.cached_observations} cached</small></span>
      <details className="radar-checks"><summary>{route.checks.length} policy checks</summary><ul>{route.checks.map((check) => <li key={check.label}><strong>{check.label}</strong><span>{check.value}</span></li>)}</ul></details>
    </div>
  )
}

function RadarMetricCell({ metric }: { metric: RadarMetric }) {
  return <span className="radar-value" role="cell"><strong>{metricValue(metric)}</strong><small>{metric.detail}</small></span>
}

function metricValue(metric: RadarMetric): string {
  if (metric.availability !== 'available' || metric.value === null) return metric.availability.replace('_', ' ')
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`
}

function radarOracleLabel(route: MarketRadarRoute): string {
  if (route.oracle.age_seconds !== null) return `${route.oracle.age_seconds}s old`
  if (route.oracle.status === 'not_used') return 'not used'
  if (route.oracle.status === 'value_available_timestamp_not_exposed') return 'timestamp not exposed'
  return route.oracle.status.replaceAll('_', ' ')
}

function costLabel(route: MarketRadarRoute): string {
  const fee = `${route.costs.protocol_fee_bps} bps protocol fee`
  const slippage = route.costs.max_execution_slippage_bps === null
    ? 'slippage limit not exposed'
    : `${route.costs.max_execution_slippage_bps} bps max slippage`
  return `${fee} · ${slippage} · ${route.costs.estimate.availability.replace('_', ' ')} estimate`
}

function oracleLabel(summary: MarketplacePerformanceSummary): string {
  if (summary.market.oracle.age_seconds !== null) return `${summary.market.oracle.age_seconds}s old`
  if (summary.market.oracle.status === 'not_used') return 'not used'
  if (summary.market.oracle.status === 'value_available_timestamp_not_exposed') return 'timestamp not exposed'
  return 'unavailable'
}

function formatDeployed(summary: MarketplacePerformanceSummary): string {
  try {
    const total = BigInt(summary.current.total_assets_raw)
    const deployed = BigInt(summary.current.deployed_assets_raw)
    return total === 0n ? '0.00%' : `${(Number(deployed * 10_000n / total) / 100).toFixed(2)}%`
  } catch {
    return 'unavailable'
  }
}

function formatBasisPoints(value: number | null): string {
  if (value === null) return 'building baseline'
  const percent = value / 100
  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`
}

function toneForBps(value: number | null): string {
  if (value === null || value === 0) return ''
  return value > 0 ? 'positive' : 'negative'
}

function formatUtc(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'time unavailable'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

function formatAge(value: string): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'time unavailable'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function short(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`
}
