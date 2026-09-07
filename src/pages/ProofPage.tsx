import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { ProofCardVisual, proofShareHref } from '../components/ProofCard'
import { formatUtc } from '../components/SystemPulse'
import { fetchProof, type ProofRecord } from '../lib/api'
import { creatorPath } from '../lib/navigation'

interface ProofPageProps {
  proofId: string | null
}

export function ProofPage({ proofId }: ProofPageProps) {
  const [proof, setProof] = useState<ProofRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!proofId) {
      setError('This URL does not contain a valid proof ID.')
      setLoading(false)
      return undefined
    }
    let active = true
    fetchProof(proofId)
      .then((response) => {
        if (!active) return
        setProof(response)
        setError('')
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'This proof could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [proofId])

  useEffect(() => {
    if (!proof) return undefined
    document.title = `${proof.title} | LiquidMuppets proof`
    return () => { document.title = 'Public Proof | LIQUIDMUPPETS' }
  }, [proof])

  const copyUrl = async () => {
    if (!proof) return
    try {
      await navigator.clipboard.writeText(proof.public_url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setCopied(false)
    }
  }

  if (loading && !proof) {
    return <div className="app-page proof-page proof-page-state"><Icon name="clock" /><p>Reading the durable proof record.</p></div>
  }

  if (!proof) {
    return <div className="app-page proof-page proof-page-state" role="alert"><Icon name="alert" /><h1>Proof unavailable.</h1><p>{error}</p><a href="/app/proofs">Open all Proof Cards</a></div>
  }

  const pool = proof.market.pool ?? proof.market.market_id ?? 'no external pool'
  return (
    <div className="app-page proof-page">
      <a className="performance-back" href="/app/proofs"><Icon name="arrow" /> All Proof Cards</a>

      <header className="proof-page-heading">
        <div><span className="pulse-eyebrow"><i />durable public URL</span><h1>{proof.category_label}</h1><p>Generated from a persisted receipt, keeper decision, or recorded checkpoint.</p></div>
        <div className="proof-page-actions">
          <button type="button" onClick={() => void copyUrl()}><Icon name={copied ? 'check' : 'receipt'} />{copied ? 'Copied' : 'Copy proof URL'}</button>
          <a href={proofShareHref(proof)} target="_blank" rel="noreferrer"><Icon name="arrow" />Share on X</a>
          <a href={proof.image_url} target="_blank" rel="noreferrer"><Icon name="layers" />Open card image</a>
        </div>
      </header>

      <ProofCardVisual proof={proof} />

      <div className="proof-detail-grid">
        <section className="proof-detail-panel">
          <header><small>event evidence</small><h2>What happened</h2></header>
          <dl>
            <div><dt>event</dt><dd>{proof.action}</dd></div>
            <div><dt>time</dt><dd>{formatUtc(proof.timestamp)}</dd></div>
            <div><dt>records grouped</dt><dd>{proof.event_count}</dd></div>
            <div><dt>reason</dt><dd>{proof.reason ?? 'The chain receipt is the event evidence.'}</dd></div>
          </dl>
          {proof.receipt.url ? <a href={proof.receipt.url} target="_blank" rel="noreferrer">Open transaction receipt <Icon name="arrow" /></a> : <span className="proof-no-transaction"><Icon name="pause" />No transaction was signed for this decision or checkpoint.</span>}
        </section>

        <section className="proof-detail-panel">
          <header><small>market context</small><h2>Latest observed health</h2></header>
          <dl>
            <div><dt>Muppet</dt><dd>{proof.subject.name}{proof.subject.agent_id === null ? '' : ` #${proof.subject.agent_id}`}</dd></div>
            <div><dt>asset</dt><dd>{proof.asset.symbol}{proof.asset.address && <code>{proof.asset.address}</code>}</dd></div>
            <div><dt>venue</dt><dd>{proof.market.venue}{proof.market.pair && <small>{proof.market.pair}</small>}</dd></div>
            <div><dt>pool / market</dt><dd><code>{pool}</code></dd></div>
            <div><dt>range</dt><dd>{proof.market.range ? `tick ${proof.market.range.lower_tick} to ${proof.market.range.upper_tick}` : 'not used for this task'}{proof.market.range && <small>current tick {proof.market.range.current_tick} · {proof.market.range.status}</small>}</dd></div>
            <div><dt>health</dt><dd>{proof.market.health_status}<small>{proof.market.health_detail}</small></dd></div>
            <div><dt>observed</dt><dd>{proof.market.observed_at ? formatUtc(proof.market.observed_at) : 'observation time unavailable'}</dd></div>
          </dl>
          <div className="proof-context-links">
            {proof.subject.performance_url && <a href={proof.subject.performance_url}>Muppet performance <Icon name="arrow" /></a>}
            {proof.subject.creator && <a href={creatorPath(proof.subject.creator)}>Creator profile <Icon name="arrow" /></a>}
          </div>
        </section>
      </div>

      <section className="proof-boundary-note"><Icon name="shield" /><div><strong>Since tracking began.</strong><p>{proof.boundary} Agent Key fills remain separate from vault ownership and performance.</p></div></section>
    </div>
  )
}
