import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ProofCardVisual, proofShareHref } from '../components/ProofCard'
import { fetchProofs, type ProofKind, type ProofListResponse } from '../lib/api'

type ProofFilter = 'all' | ProofKind

const proofFilters: Array<{ id: ProofFilter; label: string }> = [
  { id: 'all', label: 'all proofs' },
  { id: 'muppet_launch', label: 'launches' },
  { id: 'first_deposit', label: 'first deposits' },
  { id: 'keeper_action', label: 'keeper actions' },
  { id: 'keeper_daily_summary', label: 'keeper summaries' },
  { id: 'range_change', label: 'ranges' },
  { id: 'nav_milestone', label: 'NAV milestones' },
  { id: 'agent_key_fill', label: 'Key fills' },
  { id: 'reserve_purchase', label: 'reserve receipts' },
]

export function ProofsPage() {
  const query = new URLSearchParams(window.location.search)
  const creator = query.get('creator') ?? undefined
  const agentValue = query.get('agent_id')
  const agentId = agentValue !== null && /^\d+$/.test(agentValue) ? Number(agentValue) : undefined
  const [filter, setFilter] = useState<ProofFilter>('all')
  const [proofs, setProofs] = useState<ProofListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchProofs({
      limit: 100,
      kind: filter === 'all' ? undefined : filter,
      creator,
      agentId,
    })
      .then((response) => {
        if (!active) return
        setProofs(response)
        setError('')
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Proof cards are reconnecting.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [agentId, creator, filter, refreshToken])

  return (
    <div className="app-page proofs-page">
      <a className="performance-back" href="/app/pulse"><Icon name="arrow" /> System Pulse</a>

      <section className="proofs-heading">
        <div>
          <span className="pulse-eyebrow"><i />shareable protocol evidence</span>
          <h1>Proof Cards.</h1>
          <p>Durable cards and URLs generated from launches, first deposits, keeper records, range changes, tracked NAV milestones, Agent Key fills, and reserve receipts.</p>
        </div>
        <div className="proofs-heading-count"><small>matching cards</small><strong>{proofs?.items.length ?? 'reading'}</strong><span>{creator ? 'creator filtered' : agentId !== undefined ? `Muppet #${agentId}` : 'network wide'}</span></div>
      </section>

      <section className="proofs-boundary">
        <Icon name="shield" />
        <div><strong>Recorded events stay separate from projections.</strong><p>Flow-adjusted milestones start with tracked checkpoints and are never annualized. Routine keeper holds become one summary per Muppet per UTC day.</p></div>
      </section>

      <div className="proofs-toolbar">
        <div className="proofs-filters" role="group" aria-label="Filter Proof Cards">
          {proofFilters.map((item) => <button type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
        </div>
        <button type="button" className="proofs-refresh" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}><Icon name="spark" />{loading ? 'Reading' : 'Refresh'}</button>
      </div>

      {error && <div className="pulse-error" role="alert"><Icon name="alert" />{error}</div>}

      {loading && !proofs ? (
        <div className="proofs-state"><Icon name="clock" /><p>Materializing durable proof records from the public ledger.</p></div>
      ) : (
        <section className="proofs-grid" aria-label="Public proof cards">
          {proofs?.items.map((proof) => (
            <div className="proofs-grid-item" key={proof.id}>
              <ProofCardVisual proof={proof} compact />
              <div className="proofs-card-actions">
                <a href={proofShareHref(proof)} target="_blank" rel="noreferrer"><Icon name="arrow" />Share on X</a>
                <a href={proof.public_url} target="_blank" rel="noreferrer"><Icon name="receipt" />Public URL</a>
                {proof.receipt.url && <a href={proof.receipt.url} target="_blank" rel="noreferrer">Receipt <Icon name="arrow" /></a>}
              </div>
            </div>
          ))}
          {proofs?.items.length === 0 && <div className="proofs-state"><Icon name="clock" /><p>No matching recorded proof exists yet. Nothing synthetic is generated to fill the grid.</p></div>}
        </section>
      )}

      {proofs && <p className="proofs-generated">{proofs.boundary}</p>}
    </div>
  )
}
