import type { MarketplacePerformanceSummary, PulseItem } from './api'

export type MonitorAlertSeverity = 'critical' | 'warning' | 'info'

export interface MonitorAlert {
  id: string
  severity: MonitorAlertSeverity
  category: string
  timestamp: string
  title: string
  detail: string
  agentId: number | null
  agentName: string | null
  txHash: `0x${string}` | null
  source: 'market' | 'chain' | 'keeper'
}

export function buildMonitorAlerts(
  summaries: MarketplacePerformanceSummary[],
  pulseItems: PulseItem[],
  followedAgentIds: number[],
): MonitorAlert[] {
  const followed = new Set(followedAgentIds)
  const alerts: MonitorAlert[] = []

  for (const summary of summaries) {
    if (!followed.has(summary.agent.id)) continue
    alerts.push(...marketAlerts(summary))
  }

  for (const item of pulseItems) {
    if (item.category !== 'reserve' && (item.agent_id === null || !followed.has(item.agent_id))) continue
    alerts.push({
      id: `pulse:${item.id}`,
      severity: severityForPulse(item),
      category: categoryLabel(item),
      timestamp: item.timestamp,
      title: item.agent_name ? `${item.action} · ${item.agent_name}` : item.action,
      detail: pulseDetail(item),
      agentId: item.agent_id,
      agentName: item.agent_name,
      txHash: item.tx_hash,
      source: item.source,
    })
  }

  const unique = [...new Map(alerts.map((alert) => [alert.id, alert])).values()]
  return unique.sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
}

export function summaryNeedsAttention(summary: MarketplacePerformanceSummary): boolean {
  const rangeOut = summary.market.range?.in_range === false
  const oracleStale = summary.market.oracle.status === 'unavailable'
    || (summary.market.oracle.age_seconds !== null && summary.market.oracle.age_seconds > 300)
  return summary.market.health.status !== 'healthy'
    || rangeOut
    || oracleStale
    || summary.market_refresh_failed_at !== null
}

export function alertIsUnread(alert: MonitorAlert, readThrough: string | null): boolean {
  if (!readThrough) return true
  return timestampValue(alert.timestamp) > timestampValue(readThrough)
}

function marketAlerts(summary: MarketplacePerformanceSummary): MonitorAlert[] {
  const alerts: MonitorAlert[] = []
  const timestamp = summary.market_observed_at || summary.captured_at
  const base = {
    agentId: summary.agent.id,
    agentName: summary.agent.name,
    txHash: null,
    source: 'market' as const,
  }

  if (summary.market.health.status !== 'healthy') {
    alerts.push({
      ...base,
      id: `health:${summary.agent.id}:${summary.market.health.status}:${timestamp}`,
      severity: summary.market.health.status === 'unavailable' ? 'warning' : 'critical',
      category: 'market health',
      timestamp,
      title: `${summary.agent.name} market health is ${summary.market.health.status}`,
      detail: summary.market.health.detail,
    })
  }

  if (summary.market.range?.in_range === false) {
    alerts.push({
      ...base,
      id: `range:${summary.agent.id}:${timestamp}`,
      severity: 'warning',
      category: 'range',
      timestamp,
      title: `${summary.agent.name} is out of range`,
      detail: `Current tick ${summary.market.range.current_tick}; opened range ${summary.market.range.lower_tick} to ${summary.market.range.upper_tick}.`,
    })
  }

  const oracleAge = summary.market.oracle.age_seconds
  if (summary.market.oracle.status === 'unavailable' || (oracleAge !== null && oracleAge > 300)) {
    alerts.push({
      ...base,
      id: `oracle:${summary.agent.id}:${summary.market.oracle.status}:${timestamp}`,
      severity: 'warning',
      category: 'oracle',
      timestamp,
      title: `${summary.agent.name} oracle needs review`,
      detail: oracleAge !== null ? `Recorded oracle age is ${oracleAge} seconds. ${summary.market.oracle.detail}` : summary.market.oracle.detail,
    })
  }

  if (summary.market_refresh_failed_at) {
    alerts.push({
      ...base,
      id: `refresh:${summary.agent.id}:${summary.market_refresh_failed_at}`,
      severity: 'warning',
      category: 'evidence delay',
      timestamp: summary.market_refresh_failed_at,
      title: `${summary.agent.name} market evidence is delayed`,
      detail: `The last successful market observation from ${summary.market_observed_at} remains visible.`,
    })
  }

  return alerts
}

function severityForPulse(item: PulseItem): MonitorAlertSeverity {
  const action = item.action.toLowerCase()
  const status = item.status?.toLowerCase() ?? ''
  if (action.includes('held') || action === 'hold' || status.includes('skipped')) return 'warning'
  if (item.direction === 'negative') return 'warning'
  return 'info'
}

function categoryLabel(item: PulseItem): string {
  if (item.category === 'keys') return 'Agent Key'
  if (item.category === 'reserve') return 'Stock Token reserve'
  if (item.category === 'muppet') return 'Muppet launch'
  return item.category
}

function pulseDetail(item: PulseItem): string {
  if (item.reason) return item.reason
  if (item.value && item.value !== '0') return `${item.value} ${item.value_symbol ?? ''}`.trim()
  if (item.quantity) return `${item.quantity}${item.key_symbol ? ` $${item.key_symbol}` : ''}`
  return item.tx_hash ? 'Recorded onchain with a transaction receipt.' : 'Recorded decision; no transaction was signed.'
}

function timestampValue(value: string): number {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}
