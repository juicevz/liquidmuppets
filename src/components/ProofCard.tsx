import { getPet } from '../data/pets'
import type { ProofRecord } from '../lib/api'
import { proofPath } from '../lib/navigation'
import { formatUtc } from './SystemPulse'
import { Icon } from './Icon'

interface ProofCardVisualProps {
  proof: ProofRecord
  compact?: boolean
}

export function ProofCardVisual({ proof, compact = false }: ProofCardVisualProps) {
  const pet = proof.subject.pet_id === null ? null : getPet(proof.subject.pet_id)
  const pool = proof.market.pool ?? proof.market.market_id ?? 'no external pool'
  const range = proof.market.range
  const facts = compact ? proof.facts.slice(0, 3) : proof.facts

  return (
    <article className={`proof-card-visual proof-kind-${proof.kind}${compact ? ' proof-card-compact' : ''}`}>
      <div className="proof-card-grid" aria-hidden="true" />
      <header>
        <span className="proof-card-brand"><i />LIQUIDMUPPETS / public proof</span>
        <span className="proof-card-kind">{proof.category_label}</span>
      </header>

      <div className="proof-card-copy">
        <small>{proof.action}</small>
        <h2>{proof.title}</h2>
        <p>{proof.summary}</p>
      </div>

      <div className="proof-card-subject">
        {pet ? <img src={pet.portrait} alt="" /> : <span className="proof-reserve-mark"><Icon name="receipt" /></span>}
        <div><small>{proof.subject.agent_id === null ? 'network record' : `Muppet #${proof.subject.agent_id}`}</small><strong>{proof.subject.name}</strong></div>
        <span className={`proof-health proof-health-${healthClass(proof.market.health_status)}`}><i />{proof.market.health_status}</span>
      </div>

      <dl className="proof-card-evidence">
        <div><dt>asset</dt><dd>{proof.asset.symbol}{proof.asset.address && <small>{proof.asset.address}</small>}</dd></div>
        <div><dt>pool / market</dt><dd title={pool}>{pool}{range && <small>ticks {range.lower_tick} to {range.upper_tick} · current {range.current_tick}</small>}</dd></div>
        <div><dt>timestamp</dt><dd>{formatUtc(proof.timestamp)}</dd></div>
        <div><dt>receipt</dt><dd>{proof.receipt.tx_hash ? shortHash(proof.receipt.tx_hash) : 'no transaction signed'}</dd></div>
      </dl>

      {!compact && proof.reason && <p className="proof-card-reason"><Icon name="spark" />{proof.reason}</p>}

      <div className="proof-card-facts">
        {facts.map((fact) => <span key={`${fact.label}-${fact.value}`}><small>{fact.label}</small><strong>{fact.value}</strong></span>)}
      </div>

      <footer>
        <span><small>${proof.token_symbol} CA</small><code>{proof.token_address ?? 'address unavailable'}</code></span>
        <span className="proof-no-apy"><Icon name="shield" />recorded evidence · no APY projection</span>
      </footer>

      {compact && <a className="proof-card-open" href={proofPath(proof.id)}>open proof <Icon name="arrow" /></a>}
    </article>
  )
}

export function proofShareHref(proof: ProofRecord): string {
  const params = new URLSearchParams({ text: proof.share_text, url: proof.public_url })
  return `https://x.com/intent/post?${params.toString()}`
}

function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function healthClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}
