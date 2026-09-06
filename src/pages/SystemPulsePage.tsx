import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { SystemPulse, formatUtc, timeAgo } from '../components/SystemPulse'
import { fetchSystemPulse, type PulseCategory, type PulseResponse } from '../lib/api'

type PulseFilter = 'all' | PulseCategory

const filters: Array<{ id: PulseFilter; label: string }> = [
  { id: 'all', label: 'all records' },
  { id: 'muppet', label: 'Muppets' },
  { id: 'vault', label: 'vault' },
  { id: 'keeper', label: 'keeper' },
  { id: 'range', label: 'ranges' },
  { id: 'keys', label: 'Agent Keys' },
  { id: 'reserve', label: 'Stock Tokens' },
]

export function SystemPulsePage() {
  const [filter, setFilter] = useState<PulseFilter>('all')
  const [limit, setLimit] = useState(100)
  const [pulse, setPulse] = useState<PulseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let active = true
    let running = false
    const load = async () => {
      if (running) return
      running = true
      setLoading(true)
      try {
        const next = await fetchSystemPulse({ limit, category: filter === 'all' ? undefined : filter })
        if (!active) return
        setPulse(next)
        setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'System Pulse is reconnecting.')
      } finally {
        if (active) setLoading(false)
        running = false
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [filter, limit, refreshToken])

  return (
    <div className="app-page system-pulse-page">
      <section className="pulse-heading">
        <div>
          <span className="pulse-eyebrow"><i />public protocol record</span>
          <h1>System Pulse.</h1>
          <p>Deposits, withdrawals, allocations, keeper decisions, range changes, Agent Key trades, and Stock Token purchases in one readable feed.</p>
        </div>
        <div className="pulse-heading-state">
          <span><small>chain decoder</small><strong className={pulse?.source_status.chain !== 'available' ? 'source-down' : ''}>{pulse?.source_status.chain ?? 'reading'}</strong></span>
          <span><small>keeper record</small><strong>{pulse?.source_status.keeper ?? 'reading'}</strong></span>
          <span><small>latest chain record</small><strong>{pulse?.latest_chain_record_at ? timeAgo(pulse.latest_chain_record_at) : 'none yet'}</strong></span>
        </div>
      </section>

      <section className="pulse-boundary-note">
        <Icon name="shield" />
        <div><strong>Receipts and decisions stay distinct.</strong><p>Chain events link to their transaction. A keeper hold is a recorded decision and explicitly has no transaction.</p></div>
      </section>

      <div className="pulse-toolbar">
        <div className="pulse-filters" role="group" aria-label="Filter System Pulse">
          {filters.map((item) => (
            <button type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>
          ))}
        </div>
        <div className="pulse-tools">
          <label>records <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label>
          <button type="button" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}><Icon name="spark" />{loading ? 'Reading' : 'Refresh'}</button>
        </div>
      </div>

      {error && <div className="pulse-error" role="alert"><Icon name="alert" />{error}</div>}
      {pulse?.source_status.chain !== 'available' && (
        <div className="pulse-error" role="status"><Icon name="alert" />{pulse?.source_status.chain === 'stale' ? 'Chain receipt refresh failed. The last successful receipt cache remains visible.' : 'Chain receipts are reconnecting. Recorded keeper decisions remain visible.'}</div>
      )}

      <section className="pulse-ledger" aria-labelledby="pulse-ledger-title">
        <header>
          <div><small>reverse chronological</small><h2 id="pulse-ledger-title">Protocol ledger</h2></div>
          <span>{pulse ? `${pulse.items.length} latest matching records` : 'reading records'}</span>
        </header>
        {loading && !pulse
          ? <div className="pulse-loading"><Icon name="clock" />Reading decoded receipts and keeper decisions.</div>
          : <SystemPulse items={pulse?.items ?? []} explorerUrl={pulse?.explorer_url ?? ''} />}
        {pulse && <footer className="pulse-generated">Generated {formatUtc(pulse.generated_at)} · read cap {pulse.limit} records</footer>}
      </section>
    </div>
  )
}
