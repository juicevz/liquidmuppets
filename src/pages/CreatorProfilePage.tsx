import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { Icon } from '../components/Icon'
import { CreatorSlots } from '../components/CreatorSlots'
import { formatBasisPoints, formatDeployedPercent } from '../components/PerformanceMarketplace'
import { SystemPulse, formatUtc, timeAgo } from '../components/SystemPulse'
import { getPet } from '../data/pets'
import {
  fetchCreatorProfile,
  fetchSystemPulse,
  type CreatorAgentRecord,
  type CreatorProfileResponse,
  type PulseResponse,
} from '../lib/api'
import { shortenAddress } from '../lib/format'
import { performancePath } from '../lib/navigation'

interface CreatorProfilePageProps {
  creatorAddress: string | null
}

export function CreatorProfilePage({ creatorAddress }: CreatorProfilePageProps) {
  const [profile, setProfile] = useState<CreatorProfileResponse | null>(null)
  const [pulse, setPulse] = useState<PulseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!creatorAddress) {
      setError('This creator URL does not contain a valid wallet address.')
      setLoading(false)
      return undefined
    }
    let active = true
    let running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const [nextProfile, nextPulse] = await Promise.all([
          fetchCreatorProfile(creatorAddress),
          fetchSystemPulse({ creator: creatorAddress, limit: 30 }),
        ])
        if (!active) return
        setProfile(nextProfile)
        setPulse(nextPulse)
        setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'This creator record is reconnecting.')
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
  }, [creatorAddress])

  useEffect(() => {
    if (!profile) return undefined
    const title = `${profile.handle ? `@${profile.handle}` : shortenAddress(profile.wallet)} creator profile | LIQUIDMUPPETS`
    document.title = title
    return () => { document.title = 'Creator Profile | LIQUIDMUPPETS' }
  }, [profile])

  const keyMarkets = useMemo(() => profile?.agents.filter((agent) => agent.key_market.status === 'available') ?? [], [profile])
  const featuredAgents = useMemo(() => {
    const agents = new Map(profile?.agents.map((agent) => [agent.agent.id, agent]) ?? [])
    return profile?.featured_agent_ids.flatMap((id) => agents.get(id) ?? []) ?? []
  }, [profile])

  if (loading && !profile) {
    return <div className="app-page creator-profile-page creator-profile-state"><Icon name="clock" /><p>Reading this wallet’s public Muppet record.</p></div>
  }

  if (!profile) {
    return (
      <div className="app-page creator-profile-page creator-profile-state" role="alert">
        <Icon name="alert" /><h1>Creator record unavailable.</h1><p>{error}</p><a href="/app">Back to marketplace</a>
      </div>
    )
  }

  const displayName = profile.handle ? `@${profile.handle}` : shortenAddress(profile.wallet)
  const copyProfile = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="app-page creator-profile-page">
      <a className="performance-back" href="/app"><Icon name="arrow" /> Marketplace</a>
      <header className="creator-identity">
        <div className="creator-avatar"><Icon name="wallet" /></div>
        <div className="creator-title">
          <span className="creator-kicker">public creator profile</span>
          <div><h1>{displayName}</h1>{profile.handle && <span className="creator-verified"><Icon name="check" />wallet signed</span>}</div>
          <a href={`${profile.explorer_url}/address/${profile.wallet}`} target="_blank" rel="noreferrer">{profile.wallet} <Icon name="arrow" /></a>
        </div>
        <div className="creator-identity-actions">
          <a className="creator-copy" href={`/app/proofs?creator=${profile.wallet}`}><Icon name="spark" />Proof cards</a>
          <button className="creator-copy" type="button" onClick={() => void copyProfile()}><Icon name={copied ? 'check' : 'receipt'} />{copied ? 'Copied' : 'Copy profile URL'}</button>
        </div>
      </header>

      <section className="creator-record-strip">
        <span><small>Muppets launched</small><strong>{profile.agents.length}</strong></span>
        <span><small>transaction receipts</small><strong>{profile.receipt_count ?? 'reconnecting'}</strong></span>
        <span><small>tracking began</small><strong>{profile.tracking_started_at ? formatUtc(profile.tracking_started_at) : 'first checkpoint pending'}</strong></span>
        <span><small>latest checkpoint</small><strong>{profile.captured_at ? timeAgo(profile.captured_at) : 'pending'}</strong></span>
      </section>

      <CreatorSlots
        access={profile.creator_capacity}
        explorerUrl={profile.explorer_url}
        tokenAddress={profile.creator_capacity.tokenAddress}
      />

      {error && <div className="pulse-error" role="status"><Icon name="alert" />{error}</div>}

      <section className="creator-featured" aria-labelledby="creator-featured-title">
        <header>
          <div><small>slot-backed placement</small><h2 id="creator-featured-title">Featured Muppets</h2></div>
          <p>The newest Muppets fill the wallet’s currently funded placements. Every Muppet remains in the full record below.</p>
        </header>
        <div className="creator-featured-grid">
          {featuredAgents.map((agent) => <FeaturedMuppetCard record={agent} key={agent.agent.id} />)}
          {featuredAgents.length === 0 && (
            <div className="creator-section-empty">
              <Icon name="spark" />
              <p>{profile.agents.length === 0
                ? 'This wallet has no tracked Muppets to feature yet.'
                : profile.creator_capacity.reason === 'access_check_unavailable'
                  ? 'Featured placement is waiting for a fresh Creator Slot read.'
                  : `This wallet currently funds no featured placements. All ${profile.agents.length} Muppets remain in the full record.`}</p>
            </div>
          )}
        </div>
      </section>

      <section className="creator-capital" aria-labelledby="creator-capital-title">
        <header><div><small>vault capital</small><h2 id="creator-capital-title">Grouped by asset</h2></div><p>Different assets are never added into one pretend total.</p></header>
        <div className="creator-asset-grid">
          {profile.asset_totals.map((asset) => (
            <article key={`${asset.address}-${asset.symbol}`}>
              <header><span>{asset.symbol}</span><small>{asset.agent_count} Muppet{asset.agent_count === 1 ? '' : 's'}</small></header>
              <strong>{formatRaw(asset.total_assets_raw, asset.decimals)} {asset.symbol}</strong>
              <div className="creator-capital-split">
                <span><small>deployed</small><b>{formatRaw(asset.deployed_assets_raw, asset.decimals)}</b></span>
                <span><small>idle</small><b>{formatRaw(asset.idle_assets_raw, asset.decimals)}</b></span>
              </div>
              <div className="creator-allocation-track"><i style={{ width: formatDeployedPercent(asset.deployed_assets_raw, asset.total_assets_raw) }} /></div>
            </article>
          ))}
          {profile.asset_totals.length === 0 && <div className="creator-section-empty">The first tracked Muppet will create an asset group here.</div>}
        </div>
      </section>

      <div className="creator-record-layout">
        <section className="creator-agent-ledger" aria-labelledby="creator-agent-title">
          <header><div><small>vault records</small><h2 id="creator-agent-title">Muppets by this wallet</h2></div><span>since tracking began</span></header>
          <div className="creator-agent-list">
            {profile.agents.map((agent) => <CreatorAgentRow record={agent} activityStatus={profile.activity_status} key={agent.agent.id} />)}
            {profile.agents.length === 0 && <div className="creator-section-empty"><Icon name="spark" /><p>This wallet has no tracked Muppets yet.</p></div>}
          </div>
        </section>

        <aside className="creator-pulse-preview">
          <header><div><small>creator-filtered</small><h2>System Pulse</h2></div><a href="/app/pulse">all records <Icon name="arrow" /></a></header>
          {(pulse?.source_status.chain === 'stale' || pulse?.source_status.chain === 'unavailable') && <p className="creator-pulse-warning">{pulse.source_status.chain === 'stale' ? 'Showing a delayed chain receipt cache.' : 'Chain receipts are reconnecting. Keeper records may still appear.'}</p>}
          <SystemPulse items={pulse?.items.slice(0, 2) ?? []} explorerUrl={profile.explorer_url} compact />
        </aside>
      </div>

      <section className="creator-key-market" aria-labelledby="creator-key-title">
        <header>
          <div><span className="creator-key-label"><Icon name="key" />separate speculative market</span><h2 id="creator-key-title">Agent Key markets</h2></div>
          <p>Key prices do not change vault performance and Keys do not own vault assets.</p>
        </header>
        <div className="creator-key-grid">
          {keyMarkets.map((agent) => <CreatorKeyCard record={agent} explorerUrl={profile.explorer_url} key={agent.agent.id} />)}
          {keyMarkets.length === 0 && <div className="creator-section-empty">No available Agent Key market records for this wallet yet.</div>}
        </div>
      </section>
    </div>
  )
}

function FeaturedMuppetCard({ record }: { record: CreatorAgentRecord }) {
  const pet = getPet(record.agent.pet_id)
  return (
    <article>
      <span className="creator-featured-badge"><i aria-hidden="true" />funded placement</span>
      <img src={pet.portrait} alt="" />
      <div>
        <small>Muppet #{record.agent.id} · {record.agent.task_label}</small>
        <h3>{record.agent.name}</h3>
        <p>{record.asset.symbol} vault · <span className={`health-${record.market.health.status}`}>{record.market.health.status}</span></p>
      </div>
      <a href={performancePath(record.agent.id)}>open record <Icon name="arrow" /></a>
    </article>
  )
}

function CreatorAgentRow({ record, activityStatus }: { record: CreatorAgentRecord; activityStatus: CreatorProfileResponse['activity_status'] }) {
  const pet = getPet(record.agent.pet_id)
  return (
    <article className="creator-agent-row">
      <div className="creator-agent-name"><img src={pet.portrait} alt="" /><span><strong>{record.agent.name}</strong><small>{record.agent.task_label} · Muppet #{record.agent.id}</small></span></div>
      <div><small>asset / NAV</small><strong>{formatRaw(record.current.total_assets_raw, record.asset.decimals)} {record.asset.symbol}</strong></div>
      <div><small>adjusted change</small><strong className={tone(record.current.flow_adjusted_change_bps)}>{formatBasisPoints(record.current.flow_adjusted_change_bps)}</strong></div>
      <div><small>deployed</small><strong>{formatDeployedPercent(record.current.deployed_assets_raw, record.current.total_assets_raw)}</strong></div>
      <div><small>market</small><strong className={`health-${record.market.health.status}`}>{record.market.health.status}</strong></div>
      <div><small>evidence</small><strong>{record.checkpoint_count} checkpoints · {activityStatus === 'unavailable' ? 'receipts reconnecting' : `${record.receipt_count} ${(activityStatus === 'cached' || activityStatus === 'stale') ? 'cached ' : ''}receipts`}</strong></div>
      <a href={performancePath(record.agent.id)}>full performance <Icon name="arrow" /></a>
    </article>
  )
}

function CreatorKeyCard({ record, explorerUrl }: { record: CreatorAgentRecord; explorerUrl: string }) {
  const market = record.key_market
  return (
    <article>
      <header><span><small>Muppet #{record.agent.id}</small><strong>{market.symbol ? `$${market.symbol}` : record.agent.name}</strong></span><a href={`${explorerUrl}/address/${record.agent.key}`} target="_blank" rel="noreferrer"><Icon name="arrow" /></a></header>
      <dl>
        <div><dt>floor</dt><dd>{formatWei(market.floor_wei)}</dd></div>
        <div><dt>top bid</dt><dd>{formatWei(market.top_bid_wei)}</dd></div>
        <div><dt>listed</dt><dd>{market.listed_raw ?? 'unavailable'}</dd></div>
        <div><dt>supply</dt><dd>{market.supply_raw ?? 'unavailable'}</dd></div>
      </dl>
    </article>
  )
}

function formatRaw(value: string, decimals: number): string {
  const rendered = formatUnits(BigInt(value), decimals)
  const [whole, fraction = ''] = rendered.split('.')
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function formatWei(value: string | null): string {
  return value === null ? 'no open order' : `${formatRaw(value, 18)} ETH`
}

function tone(value: number | null): string {
  if (!value) return ''
  return value > 0 ? 'positive' : 'negative'
}
