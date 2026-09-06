import { useCallback, useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { Icon } from '../components/Icon'
import { getPet } from '../data/pets'
import {
  fetchAgentActivity,
  fetchMuppetPerformance,
  type ActivityItem,
  type MarketEvidence,
  type MuppetPerformance,
  type PerformanceCheckpoint,
} from '../lib/api'
import { formatEthValue } from '../lib/protocol'
import { creatorPath } from '../lib/navigation'

interface MuppetPerformancePageProps {
  agentId: number | null
}

type ChartMetric = 'share' | 'nav'

const VAULT_ACTIONS = new Set([
  'launched',
  'deposited',
  'withdrew',
  'allocated',
  'recalled',
  'opened range',
  'closed range',
  'staged',
  'released',
])

export function MuppetPerformancePage({ agentId }: MuppetPerformancePageProps) {
  const [performance, setPerformance] = useState<MuppetPerformance | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState<ChartMetric>('share')
  const [shareState, setShareState] = useState('Share page')

  const load = useCallback(async () => {
    if (agentId === null) {
      setError('This performance URL does not contain a valid Muppet ID.')
      setLoading(false)
      return
    }
    try {
      void fetchAgentActivity(agentId, 100)
        .then(setActivity)
        .catch(() => undefined)
      const next = await fetchMuppetPerformance(agentId)
      setPerformance(next)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Performance evidence could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const sharePage = async () => {
    const title = performance ? `${performance.agent.name} performance | LIQUIDMUPPETS` : document.title
    try {
      if (navigator.share) {
        await navigator.share({ title, url: window.location.href })
        setShareState('Shared')
      } else {
        await navigator.clipboard.writeText(window.location.href)
        setShareState('Link copied')
      }
    } catch {
      return
    }
    window.setTimeout(() => setShareState('Share page'), 2_000)
  }

  if (loading && !performance) {
    return <div className="app-page performance-page performance-state"><Icon name="clock" /><p>Recording and reading the first public checkpoint.</p></div>
  }

  if (!performance) {
    return (
      <div className="app-page performance-page performance-state" role="alert">
        <Icon name="alert" />
        <h1>Performance page unavailable.</h1>
        <p>{error}</p>
        <a href="/app">Back to marketplace</a>
      </div>
    )
  }

  const pet = getPet(performance.agent.pet_id)
  const current = performance.current
  const totalAssets = BigInt(current.total_assets_raw)
  const deployedAssets = BigInt(current.deployed_assets_raw)
  const deployedBps = totalAssets === 0n ? 0 : Number(deployedAssets * 10_000n / totalAssets)
  const vaultActivity = activity.filter((item) => VAULT_ACTIONS.has(item.action))
  const explorerUrl = performance.network.explorer_url

  return (
    <div className="app-page performance-page">
      <a className="performance-back" href="/app"><Icon name="arrow" /> Marketplace</a>

      <header className="performance-identity">
        <div className="performance-agent">
          <div className="performance-portrait"><img src={pet.portrait} alt={`${pet.name} Muppet`} /></div>
          <div>
            <div className="performance-title-line">
              <h1>{performance.agent.name}</h1>
              <span className={`performance-health health-${performance.market.health.status}`}><i />{performance.market.health.status}</span>
            </div>
            <p>{performance.agent.task_label} · Muppet #{performance.agent.id}</p>
            <a href={`${explorerUrl}/address/${performance.agent.vault}`} target="_blank" rel="noreferrer">
              vault {short(performance.agent.vault)} <Icon name="arrow" />
            </a>
            <a href={creatorPath(performance.agent.creator)}>
              creator {short(performance.agent.creator)} <Icon name="arrow" />
            </a>
          </div>
        </div>
        <div className="performance-actions">
          <button type="button" onClick={() => void sharePage()}><Icon name="receipt" />{shareState}</button>
          <button type="button" onClick={() => void load()}><Icon name="spark" />Refresh</button>
        </div>
      </header>

      {error && <div className="performance-notice" role="status"><Icon name="alert" />{error}</div>}

      <div className="performance-layout">
        <div className="performance-main-column">
          <section className="performance-panel performance-chart-panel">
            <div className="performance-panel-head chart-panel-head">
              <div>
                <small>vault performance</small>
                <h2>Since tracking began</h2>
                <p>{formatUtc(performance.tracking_started_at)} · latest checkpoint {formatAge(performance.captured_at)}</p>
              </div>
              <div className="performance-chart-tabs" role="group" aria-label="Performance chart metric">
                <button type="button" className={metric === 'share' ? 'active' : ''} onClick={() => setMetric('share')}>Share price</button>
                <button type="button" className={metric === 'nav' ? 'active' : ''} onClick={() => setMetric('nav')}>NAV</button>
              </div>
            </div>
            <PerformanceChart
              history={performance.history}
              metric={metric}
              assetDecimals={performance.asset.decimals}
              assetSymbol={performance.asset.symbol}
            />
            <div className="performance-change-strip">
              <Metric label="current share price" value={`${formatRaw(current.share_price_raw, performance.asset.decimals, 8)} ${performance.asset.symbol}`} />
              <Metric label="current NAV" value={`${formatRaw(current.total_assets_raw, performance.asset.decimals)} ${performance.asset.symbol}`} />
              <Metric
                label="flow-adjusted change"
                value={formatBasisPoints(current.flow_adjusted_change_bps)}
                tone={toneForBps(current.flow_adjusted_change_bps)}
              />
              <Metric
                label="strategy asset change"
                value={`${formatSignedRaw(current.flow_adjusted_change_raw, performance.asset.decimals)} ${performance.asset.symbol}`}
                tone={toneForRaw(current.flow_adjusted_change_raw)}
              />
            </div>
            <div className="performance-method"><Icon name="shield" /><p>{performance.change_method.explanation} No annualized rate is shown.</p></div>
          </section>

          <section className="performance-panel receipt-ledger">
            <div className="performance-panel-head">
              <div><small>onchain records</small><h2>Vault receipts</h2></div>
              <span>{vaultActivity.length} decoded events</span>
            </div>
            <ReceiptLedger activity={vaultActivity} explorerUrl={explorerUrl} />
          </section>
        </div>

        <aside className="performance-side-column">
          <section className="performance-panel capital-panel">
            <div className="performance-panel-head"><div><small>capital</small><h2>Deployed versus idle</h2></div></div>
            <div className="capital-bar" aria-label={`${deployedBps / 100}% deployed`}><span style={{ width: `${deployedBps / 100}%` }} /></div>
            <div className="capital-values">
              <Metric label="deployed" value={`${formatRaw(current.deployed_assets_raw, performance.asset.decimals)} ${performance.asset.symbol}`} />
              <Metric label="idle" value={`${formatRaw(current.idle_assets_raw, performance.asset.decimals)} ${performance.asset.symbol}`} />
            </div>
            <p>{(deployedBps / 100).toFixed(2)}% deployed · {((10_000 - deployedBps) / 100).toFixed(2)}% idle</p>
          </section>

          <MarketEvidencePanel market={performance.market} explorerUrl={explorerUrl} />

          <section className="performance-panel keeper-panel">
            <div className="performance-panel-head"><div><small>automation record</small><h2>Last keeper decision</h2></div><Icon name="spark" /></div>
            {performance.keeper ? (
              <div className="keeper-decision">
                <div><span className={`decision-${performance.keeper.action}`}>{performance.keeper.action}</span><time dateTime={performance.keeper.created_at}>{formatAge(performance.keeper.created_at)}</time></div>
                <p>{performance.keeper.reason}</p>
                <dl>
                  <div><dt>status</dt><dd>{performance.keeper.status}</dd></div>
                  <div><dt>amount</dt><dd>{formatRaw(performance.keeper.amount, performance.asset.decimals)} {performance.asset.symbol}</dd></div>
                </dl>
                {performance.keeper.tx_hash
                  ? <a href={`${explorerUrl}/tx/${performance.keeper.tx_hash}`} target="_blank" rel="noreferrer">Open transaction receipt <Icon name="arrow" /></a>
                  : <span className="keeper-no-transaction">Held without signing a transaction</span>}
              </div>
            ) : <p className="performance-empty">No keeper decision has been recorded for this vault yet.</p>}
          </section>
        </aside>
      </div>

      <AgentKeySection performance={performance} explorerUrl={explorerUrl} />
    </div>
  )
}

function PerformanceChart({
  history,
  metric,
  assetDecimals,
  assetSymbol,
}: {
  history: PerformanceCheckpoint[]
  metric: ChartMetric
  assetDecimals: number
  assetSymbol: string
}) {
  const width = 820
  const height = 260
  const top = 18
  const bottom = 28
  const values = history.map((point) => Number(formatUnits(BigInt(metric === 'share' ? point.share_price_raw : point.total_assets_raw), assetDecimals)))
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max((maximum - minimum) * 0.12, Math.abs(maximum || 1) * 0.002)
  const low = minimum - padding
  const high = maximum + padding
  const range = high - low || 1
  const points = values.map((value, index) => ({
    x: history.length === 1 ? width / 2 : index * width / (history.length - 1),
    y: top + (high - value) / range * (height - top - bottom),
  }))
  const pointString = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const latest = values.at(-1) ?? 0

  return (
    <div className="performance-chart">
      <div className="chart-current"><small>{metric === 'share' ? 'share price' : 'NAV'}</small><strong>{formatDecimal(latest)} {assetSymbol}</strong></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric === 'share' ? 'Vault share price' : 'Vault NAV'} since tracking began`}>
        {[0, 1, 2, 3, 4].map((line) => <line x1="0" x2={width} y1={top + line * (height - top - bottom) / 4} y2={top + line * (height - top - bottom) / 4} key={line} />)}
        {history.length > 1 && <polyline points={pointString} />}
        {points.map((point, index) => <circle cx={point.x} cy={point.y} r={index === points.length - 1 ? 4 : 2} key={`${point.x}-${point.y}`} />)}
      </svg>
      <div className="chart-axis"><span>{formatChartDate(history[0]?.timestamp)}</span><span>{history.length === 1 ? 'first checkpoint' : `${history.length} checkpoints shown`}</span><span>{formatChartDate(history.at(-1)?.timestamp)}</span></div>
      {history.length === 1 && <p className="chart-first-note">The first checkpoint is live. This chart will build from observed blocks only.</p>}
    </div>
  )
}

function MarketEvidencePanel({ market, explorerUrl }: { market: MarketEvidence; explorerUrl: string }) {
  const oracleLabel = market.oracle.age_seconds !== null
    ? `${market.oracle.age_seconds}s old`
    : market.oracle.status === 'not_used'
      ? 'not used by this task'
      : market.oracle.status === 'value_available_timestamp_not_exposed'
        ? 'value available · timestamp not exposed'
        : 'unavailable'
  const marketReference = market.pool ?? market.market_id ?? 'no external pool'
  const marketHref = market.pool ? `${explorerUrl}/address/${market.pool}` : null

  return (
    <section className="performance-panel market-evidence-panel">
      <div className="performance-panel-head"><div><small>current route</small><h2>Market evidence</h2></div><span className={`market-status health-${market.health.status}`}>{market.health.status}</span></div>
      <dl className="evidence-list">
        <div><dt>asset</dt><dd>{market.asset.symbol}<code>{market.asset.address}</code></dd></div>
        <div><dt>venue</dt><dd>{market.venue}<small>{market.pair}</small></dd></div>
        <div><dt>{market.pool ? 'pool' : market.market_id ? 'market ID' : 'pool'}</dt><dd>{marketHref ? <a href={marketHref} target="_blank" rel="noreferrer">{marketReference}</a> : <code>{marketReference}</code>}</dd></div>
        {market.range && <div><dt>{market.range.status === 'open' ? 'exact range' : 'next range'}</dt><dd>tick {market.range.lower_tick} to {market.range.upper_tick}<small>current tick {market.range.current_tick}{market.range.in_range === null ? '' : market.range.in_range ? ' · in range' : ' · out of range'}</small></dd></div>}
        <div><dt>oracle freshness</dt><dd>{oracleLabel}<small>{market.oracle.detail}</small></dd></div>
        <div><dt>health</dt><dd>{market.health.detail}</dd></div>
      </dl>
    </section>
  )
}

function ReceiptLedger({ activity, explorerUrl }: { activity: ActivityItem[]; explorerUrl: string }) {
  if (activity.length === 0) return <p className="performance-empty">No vault events have been emitted for this Muppet yet.</p>
  return (
    <div className="receipt-table-wrap">
      <div className="receipt-table-head"><span>event</span><span>actor</span><span>value</span><span>block / time</span><span>receipt</span></div>
      {activity.map((item) => (
        <div className="receipt-row" key={item.id}>
          <strong className={`receipt-${item.direction}`}>{item.action}</strong>
          <span title={item.actor}>{short(item.actor)}</span>
          <b>{item.value ? `${item.value} ${item.value_symbol}` : item.quantity ?? 'recorded'}</b>
          <span><small>#{item.block_number}</small>{formatAge(item.timestamp)}</span>
          <a href={`${explorerUrl}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer" aria-label={`Open ${item.action} transaction receipt`}><Icon name="arrow" /></a>
        </div>
      ))}
    </div>
  )
}

function AgentKeySection({
  performance,
  explorerUrl,
}: {
  performance: MuppetPerformance
  explorerUrl: string
}) {
  const market = performance.key_market
  return (
    <section className="performance-key-section">
      <div className="key-section-heading">
        <div><small>separate market</small><h2>Agent Key market</h2><p>Agent Keys are distinct from vault shares and have no claim on vault assets.</p></div>
        <a href="/app">Open marketplace <Icon name="arrow" /></a>
      </div>
      <div className="performance-key-grid">
        <div className="key-identity"><Icon name="key" /><div><small>Key contract</small><strong>{market.symbol ? `$${market.symbol}` : 'Agent Key'}</strong><a href={`${explorerUrl}/address/${performance.agent.key}`} target="_blank" rel="noreferrer">{performance.agent.key}</a></div></div>
        {market.status === 'available' ? (
          <>
            <Metric label="floor" value={formatEthValue(market.floor_wei === null ? null : BigInt(market.floor_wei))} />
            <Metric label="top bid" value={formatEthValue(market.top_bid_wei === null ? null : BigInt(market.top_bid_wei))} />
            <Metric label="listed" value={market.listed_raw ?? '0'} />
            <Metric label="supply" value={market.supply_raw ?? '0'} />
            <Metric label="bound" value={market.total_bound_raw ?? '0'} />
            <Metric label="market fee" value={market.fee_bps === null ? 'unavailable' : `${market.fee_bps / 100}%`} />
          </>
        ) : <p className="performance-empty">{market.detail} The contract link remains available.</p>}
      </div>
    </section>
  )
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`performance-metric ${tone}`}><small>{label}</small><strong>{value}</strong></div>
}

function formatRaw(raw: string, decimals: number, digits = 6): string {
  const rendered = formatUnits(BigInt(raw), decimals)
  const [whole, fraction = ''] = rendered.split('.')
  const compact = fraction.slice(0, digits).replace(/0+$/, '')
  return compact ? `${whole}.${compact}` : whole
}

function formatSignedRaw(raw: string, decimals: number): string {
  const value = BigInt(raw)
  if (value === 0n) return '0'
  const rendered = formatRaw((value < 0n ? -value : value).toString(), decimals)
  return `${value > 0n ? '+' : '-'}${rendered}`
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

function toneForRaw(value: string): string {
  const amount = BigInt(value)
  if (amount === 0n) return ''
  return amount > 0n ? 'positive' : 'negative'
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
}

function formatUtc(timestamp: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(timestamp))
}

function formatChartDate(timestamp?: string): string {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(timestamp))
}

function formatAge(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function short(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}
