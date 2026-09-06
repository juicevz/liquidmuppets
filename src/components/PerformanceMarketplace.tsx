import { formatUnits } from 'viem'
import { getPet } from '../data/pets'
import type { MarketplacePerformanceSummary } from '../lib/api'
import { performancePath } from '../lib/navigation'
import type { ChainAgent } from '../lib/protocol'
import { Icon } from './Icon'

interface PerformanceMarketplaceProps {
  agents: ChainAgent[]
  summaries: Map<number, MarketplacePerformanceSummary>
  loading: boolean
  failed: boolean
  selectedIds: number[]
  onToggleComparison: (agentId: number) => void
  onClearComparison: () => void
  onOpenAgent: (agent: ChainAgent) => void
}

export function PerformanceMarketplace({
  agents,
  summaries,
  loading,
  failed,
  selectedIds,
  onToggleComparison,
  onClearComparison,
  onOpenAgent,
}: PerformanceMarketplaceProps) {
  const selected = selectedIds
    .map((agentId) => agents.find((agent) => Number(agent.id) === agentId))
    .filter((agent): agent is ChainAgent => agent !== undefined)

  return (
    <>
      <section className="performance-marketplace" aria-labelledby="performance-marketplace-title">
        <header className="performance-marketplace-heading">
          <div>
            <small>vault marketplace</small>
            <h2 id="performance-marketplace-title">Performance since tracking began</h2>
            <p>Recorded checkpoints only. Deposits and withdrawals are removed from the displayed change.</p>
          </div>
          <span className={`performance-marketplace-source${failed ? ' unavailable' : ''}`}>
            <i />
            {failed ? 'record reconnecting' : loading ? 'reading records' : 'five minute checkpoints'}
          </span>
        </header>

        <div className="performance-market-table-wrap">
          <div className="performance-market-table" role="table" aria-label="Muppet vault performance marketplace">
            <div className="performance-market-table-head" role="row">
              <span role="columnheader">Muppet / asset</span>
              <span role="columnheader">tracked since</span>
              <span role="columnheader">adjusted change</span>
              <span role="columnheader">deployed</span>
              <span role="columnheader">market health</span>
              <span role="columnheader">oracle</span>
              <span role="columnheader">last keeper</span>
              <span role="columnheader">compare</span>
            </div>

            {agents.map((agent) => {
              const agentId = Number(agent.id)
              const summary = summaries.get(agentId)
              const isSelected = selectedIds.includes(agentId)
              const compareLimitReached = selectedIds.length >= 2 && !isSelected
              const pet = getPet(agent.petId)
              const totalAssets = summary?.current.total_assets_raw ?? agent.vault.totalAssets.toString()
              const deployedAssets = summary?.current.deployed_assets_raw ?? agent.vault.deployedAssets.toString()

              return (
                <div
                  className={`performance-market-row${isSelected ? ' comparison-selected' : ''}`}
                  role="row"
                  key={agent.id.toString()}
                >
                  <span className="performance-market-agent-cell" role="cell">
                    <button
                      type="button"
                      className="performance-market-agent"
                      onClick={() => onOpenAgent(agent)}
                      aria-label={`Open ${agent.name} market and vault`}
                    >
                      <img src={pet.portrait} alt="" />
                      <span><strong>{agent.name}</strong><small>{summary?.asset.symbol ?? agent.vault.assetSymbol} · Muppet #{agentId}</small></span>
                    </button>
                  </span>
                  <span className="performance-market-value tracking-value" role="cell">
                    <strong>{summary ? formatUtc(summary.tracking_started_at) : 'first checkpoint pending'}</strong>
                    <small>{summary ? `${formatElapsed(summary.tracking_started_at, summary.captured_at)} observed` : 'recording from now'}</small>
                  </span>
                  <span className={`performance-market-value ${toneForBps(summary?.current.flow_adjusted_change_bps)}`} role="cell">
                    <strong>{summary ? formatBasisPoints(summary.current.flow_adjusted_change_bps) : 'pending'}</strong>
                    <small>flow-adjusted</small>
                  </span>
                  <span className="performance-market-value" role="cell">
                    <strong>{formatDeployedPercent(deployedAssets, totalAssets)}</strong>
                    <small>{summary ? `checkpoint ${formatAge(summary.captured_at)}` : 'live vault read'}</small>
                  </span>
                  <span className="performance-market-value" role="cell">
                    <HealthBadge status={summary?.market.health.status} />
                    <small title={summary?.market.health.detail}>{summary?.market.venue ?? 'market record pending'}</small>
                  </span>
                  <span className="performance-market-value" role="cell">
                    <strong>{summary ? oracleLabel(summary) : 'pending'}</strong>
                    <small>{summary ? marketObservationLabel(summary) : 'no freshness claim'}</small>
                  </span>
                  <span className="performance-market-value keeper-value" role="cell">
                    {summary?.keeper
                      ? <><strong>{summary.keeper.action}</strong><small title={summary.keeper.reason}>{summary.keeper.reason}</small><em>{formatAge(summary.keeper.created_at)}</em></>
                      : <><strong>{summary ? 'no decision' : 'pending'}</strong><small>{summary ? 'nothing recorded yet' : 'reading keeper record'}</small></>}
                  </span>
                  <span className="performance-market-compare" role="cell">
                    <button
                      type="button"
                      className={isSelected ? 'selected' : ''}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Remove' : 'Compare'} ${agent.name}`}
                      disabled={compareLimitReached}
                      onClick={() => onToggleComparison(agentId)}
                    >
                      {isSelected ? <Icon name="check" /> : <Icon name="layers" />}
                      {isSelected ? 'selected' : 'compare'}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <footer className="performance-marketplace-footer">
          <span><Icon name="shield" />Every result stays in its own asset and observed tracking window. No cross-asset ranking is calculated.</span>
          <strong>{selectedIds.length}/2 selected</strong>
        </footer>
      </section>

      {selectedIds.length > 0 && (
        <ComparisonPanel
          selected={selected}
          summaries={summaries}
          onClear={onClearComparison}
        />
      )}
    </>
  )
}

function ComparisonPanel({
  selected,
  summaries,
  onClear,
}: {
  selected: ChainAgent[]
  summaries: Map<number, MarketplacePerformanceSummary>
  onClear: () => void
}) {
  const selectedSummaries = selected
    .map((agent) => summaries.get(Number(agent.id)))
    .filter((summary): summary is MarketplacePerformanceSummary => summary !== undefined)
  const assets = [...new Set(selected.map((agent) => summaries.get(Number(agent.id))?.asset.symbol ?? agent.vault.assetSymbol))]
  const starts = selectedSummaries.map((summary) => summary.tracking_started_at)

  return (
    <section className="muppet-comparison" aria-labelledby="muppet-comparison-title">
      <header>
        <div><small>side by side</small><h2 id="muppet-comparison-title">Compare Muppets</h2></div>
        <button type="button" onClick={onClear}><Icon name="close" />Clear</button>
      </header>

      {selected.length === 2 ? (
        <div className="comparison-boundaries">
          <span><Icon name="layers" /><strong>{assets.length > 1 ? `Different assets: ${assets.join(' and ')}` : `Shared asset: ${assets[0]}`}</strong> Values remain in native asset units.</span>
          <span><Icon name="clock" /><strong>{starts.length === 2 && starts[0] !== starts[1] ? 'Different tracking starts' : 'Independent tracking windows'}</strong> Each result begins at its own first recorded checkpoint.</span>
        </div>
      ) : (
        <div className="comparison-prompt"><Icon name="layers" />Choose one more Muppet from the performance rows.</div>
      )}

      <div className="comparison-grid">
        {selected.map((agent) => (
          <ComparisonCard agent={agent} summary={summaries.get(Number(agent.id))} key={agent.id.toString()} />
        ))}
        {selected.length < 2 && <div className="comparison-empty"><Icon name="layers" /><span>Second comparison slot</span></div>}
      </div>
    </section>
  )
}

function ComparisonCard({ agent, summary }: { agent: ChainAgent; summary?: MarketplacePerformanceSummary }) {
  const pet = getPet(agent.petId)
  const totalAssets = summary?.current.total_assets_raw ?? agent.vault.totalAssets.toString()
  const deployedAssets = summary?.current.deployed_assets_raw ?? agent.vault.deployedAssets.toString()
  const assetSymbol = summary?.asset.symbol ?? agent.vault.assetSymbol
  const assetDecimals = summary?.asset.decimals ?? agent.vault.assetDecimals

  return (
    <article className="comparison-card">
      <header>
        <img src={pet.portrait} alt="" />
        <span><strong>{agent.name}</strong><small>{summary?.agent.task_label ?? `task ${agent.taskId}`} · {assetSymbol}</small></span>
        <a href={performancePath(agent.id)}>full record <Icon name="arrow" /></a>
      </header>
      <dl>
        <ComparisonMetric label="tracked asset" value={assetSymbol} note="no currency conversion" />
        <ComparisonMetric
          label="tracking began"
          value={summary ? formatUtc(summary.tracking_started_at) : 'checkpoint pending'}
          note={summary ? `${formatElapsed(summary.tracking_started_at, summary.captured_at)} observed` : 'recording from now'}
        />
        <ComparisonMetric
          label="flow-adjusted change"
          value={summary ? formatBasisPoints(summary.current.flow_adjusted_change_bps) : 'pending'}
          note="deposits removed, withdrawals added"
          tone={toneForBps(summary?.current.flow_adjusted_change_bps)}
        />
        <ComparisonMetric
          label="current NAV"
          value={`${formatRaw(totalAssets, assetDecimals)} ${assetSymbol}`}
          note={summary ? `checkpoint ${formatAge(summary.captured_at)}` : 'live vault read'}
        />
        <ComparisonMetric
          label="deployed / idle"
          value={`${formatDeployedPercent(deployedAssets, totalAssets)} / ${formatIdlePercent(deployedAssets, totalAssets)}`}
          note="share of current vault assets"
        />
        <ComparisonMetric
          label="market health"
          value={summary?.market.health.status ?? 'pending'}
          note={summary?.market.health.detail ?? 'market evidence is still recording'}
          tone={summary?.market.health.status === 'healthy' ? 'positive' : summary ? 'negative' : ''}
        />
        <ComparisonMetric
          label="oracle freshness"
          value={summary ? oracleLabel(summary) : 'pending'}
          note={summary ? `${summary.market.oracle.detail} · ${marketObservationLabel(summary)}` : 'no freshness claim until evidence loads'}
        />
        <ComparisonMetric
          label="last keeper decision"
          value={summary?.keeper?.action ?? (summary ? 'no decision' : 'pending')}
          note={summary?.keeper ? `${summary.keeper.reason} · ${formatAge(summary.keeper.created_at)}` : 'nothing recorded yet'}
        />
      </dl>
    </article>
  )
}

function ComparisonMetric({
  label,
  value,
  note,
  tone = '',
}: {
  label: string
  value: string
  note: string
  tone?: string
}) {
  return <div className={tone}><dt>{label}</dt><dd><strong>{value}</strong><small>{note}</small></dd></div>
}

function HealthBadge({ status }: { status?: MarketplacePerformanceSummary['market']['health']['status'] }) {
  return <strong className={`market-performance-health health-${status ?? 'recording'}`}><i />{status ?? 'recording'}</strong>
}

export function formatBasisPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'baseline only'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${(value / 100).toFixed(2)}%`
}

export function formatDeployedPercent(deployedRaw: string, totalRaw: string): string {
  const total = BigInt(totalRaw)
  if (total === 0n) return '0.00%'
  return `${(Number(BigInt(deployedRaw) * 10_000n / total) / 100).toFixed(2)}%`
}

export function formatIdlePercent(deployedRaw: string, totalRaw: string): string {
  const total = BigInt(totalRaw)
  if (total === 0n) return '100.00%'
  const deployedBps = Number(BigInt(deployedRaw) * 10_000n / total)
  return `${((10_000 - deployedBps) / 100).toFixed(2)}%`
}

export function oracleLabel(summary: MarketplacePerformanceSummary): string {
  const oracle = summary.market.oracle
  if (oracle.age_seconds !== null) return `${formatSeconds(oracle.age_seconds)} old`
  if (oracle.status === 'not_used') return 'not used'
  if (oracle.status === 'value_available_timestamp_not_exposed') return 'timestamp not exposed'
  return 'unavailable'
}

export function formatElapsed(startValue: string, endValue: string): string {
  const start = new Date(startValue).getTime()
  const end = new Date(endValue).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unknown window'
  return formatSeconds(Math.max(0, Math.floor((end - start) / 1_000)))
}

function marketObservationLabel(summary: MarketplacePerformanceSummary): string {
  const age = formatAge(summary.market_observed_at)
  return summary.market_refresh_failed_at ? `last good ${age} · refresh retrying` : `observed ${age}`
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds % 3_600 / 60)}m`
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`
}

function formatAge(value: string): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'time unavailable'
  return `${formatSeconds(Math.max(0, Math.floor((Date.now() - timestamp) / 1_000)))} ago`
}

function formatUtc(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return 'time unavailable'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(timestamp.getUTCDate()).padStart(2, '0')
  const hour = String(timestamp.getUTCHours()).padStart(2, '0')
  const minute = String(timestamp.getUTCMinutes()).padStart(2, '0')
  return `${day} ${months[timestamp.getUTCMonth()]} ${hour}:${minute} UTC`
}

function formatRaw(value: string, decimals: number): string {
  const raw = formatUnits(BigInt(value), decimals)
  const [whole, fraction = ''] = raw.split('.')
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function toneForBps(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return ''
  return value > 0 ? 'positive' : 'negative'
}
