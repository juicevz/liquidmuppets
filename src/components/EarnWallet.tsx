import { useEffect, useState } from 'react'
import type { Address, Hash } from 'viem'
import type { EarnWeeksState, ProtocolConfig, RevenueState } from '../lib/api'
import { formatEarnAmount, getEarnPositionPhase } from '../lib/earn'
import { shortenAddress } from '../lib/format'
import type { AgentBondKeyPosition, ChainAgent } from '../lib/protocol'
import { RewardReinvestment } from './RewardReinvestment'

interface Props {
  walletAddress?: string
  state: RevenueState
  config: ProtocolConfig | null
  keyPositions: Record<string, AgentBondKeyPosition>
  agents: ChainAgent[]
  busy: boolean
  positionCursor: number
  onCursor: (cursor: number) => void
  onConnect: () => Promise<void>
  onBusy: (busy: boolean) => void
  onConfirmed: (hash: Hash) => void
  onClaim: (positionId: bigint) => void
  onUnbond: (positionId: bigint) => void
}

const phases = {
  maturing: 'Warming up', waiting_for_epoch: 'Waiting for a full week', eligible: 'Eligible this week',
  eligibility_complete: 'Eligible weeks complete', unlocked: 'Ready to withdraw', withdrawn: 'Withdrawn', unavailable: 'Timing unavailable',
}

export function EarnWallet(props: Props) {
  const { walletAddress, state, config, keyPositions, agents, busy, positionCursor, onCursor, onConnect, onBusy, onConfirmed, onClaim, onUnbond } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [connectError, setConnectError] = useState('')
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    setSelected(null)
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [walletAddress, positionCursor])
  const matchingWallet = walletAddress && state.wallet?.address.toLowerCase() === walletAddress.toLowerCase()
  const earn = matchingWallet ? state.wallet?.earn : undefined
  const cursorReady = earn?.position_cursor === positionCursor

  if (!walletAddress) return (
    <section className="earn-connect" aria-label="Your rewards">
      <h2>See your rewards.</h2><p>Connect your wallet to see your bonds, claimable WETH and past payouts. Connecting does not move any tokens.</p>
      <button type="button" onClick={() => void onConnect().catch((reason: unknown) => setConnectError(reason instanceof Error ? reason.message : 'Wallet connection did not complete.'))}>Connect wallet</button>
      {connectError && <p role="alert">{connectError}</p>}
    </section>
  )

  return (
    <div className="earn-wallet">
      <section aria-label="Your rewards">
        <header className="earn-section-header"><h2>Your rewards</h2><span>{shortenAddress(walletAddress)}</span></header>
        {!earn && <p role="status">Reading this wallet’s rewards.</p>}
        {earn && earn.status !== 'available' && <p className="earn-notice" role="status">{earn.reason}</p>}
        <div className="earn-metrics">
          <article><span>Staked $MUPPETS</span><strong>{formatEarnAmount(earn?.staked_muppets_raw, '$MUPPETS')}</strong><p>Tokens currently held in your bonds.</p></article>
          <article><span>Claimable WETH</span><strong>{formatEarnAmount(earn?.claimable_weth_raw, 'WETH')}</strong><p>Rewards available to claim from your positions.</p></article>
          <article><span>Total rewards claimed</span><strong>{formatEarnAmount(earn?.claimed_weth_raw, 'WETH')}</strong><p>Includes rewards you chose to reinvest.</p></article>
        </div>
        <div className="earn-reward-breakdown"><span>Received in wallet <b>{formatEarnAmount(earn?.received_weth_raw, 'WETH')}</b></span><span>Used to reinvest <b>{formatEarnAmount(earn?.reinvested_weth_raw, 'WETH')}</b></span></div>
        <p className="earn-footnote">Only bond rewards count here. Vault deposits and token purchases are not earnings.{earn?.block_number != null && ` Read at block ${earn.block_number.toLocaleString('en-US')}.`}</p>
      </section>

      <section className="earn-positions" aria-label="Your bonds">
        <header className="earn-section-header"><h2>Your bonds</h2><span>{earn?.positions_total == null ? 'Not available yet' : `${earn.positions_total} positions`}</span></header>
        {state.status === 'live' && <div className="earn-position-actions"><button type="button" disabled={busy} onClick={() => {
          const details = document.querySelector<HTMLDetailsElement>('.earn-advanced')
          if (details) details.open = true
          document.getElementById('revenue-bond-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}>Open a bond</button><p className="earn-footnote">15,000 $MUPPETS and one unused, permanently bound Key per unit.</p></div>}
        {!earn || !cursorReady ? <p>Loading bonds.</p> : earn.positions_status !== 'available' ? <p>{earn.status === 'activation_pending' ? 'Bonds will appear here after staking is activated.' : 'Bond positions are unavailable. Try again shortly.'}</p> : earn.positions.length === 0 ? <p>No bonds yet.</p> : (
          <div className="earn-position-list">{earn.positions.map((position) => {
            const phase = getEarnPositionPhase({ now, maturesAt: position.matures_at, eligibleFrom: position.eligible_from, eligibleUntil: position.eligible_until, unlockAt: position.unlock_at, withdrawn: position.withdrawn })
            const claimable = BigInt(position.claimable_global_weth_raw) + BigInt(position.claimable_key_weth_raw)
            const agent = agents.find((item) => item.key.address.toLowerCase() === position.key.toLowerCase())
            const keyPosition = keyPositions[position.key.toLowerCase()]
            return <article className="earn-position" key={position.id}>
              <header><div><h3>{agent?.name ?? `Bond #${position.id}`}</h3><span>Position #{position.id} · {position.term_days} days · Key {shortenAddress(position.key)}</span></div><strong>{phases[phase]}</strong></header>
              <dl><div><dt>{position.withdrawn ? 'Original bond' : 'Staked'}</dt><dd>{formatEarnAmount(position.muppets_raw, '$MUPPETS')}</dd></div><div><dt>Claimable</dt><dd>{formatEarnAmount(claimable.toString(), 'WETH')}</dd></div><div><dt>Eligible from</dt><dd>{date(position.eligible_from)}</dd></div><div><dt>Unlock</dt><dd>{date(position.unlock_at)}</dd></div></dl>
              <p className="earn-footnote">Eligible weeks end {date(position.eligible_until)}. Eligibility is not a promised payout.</p>
              <div className="earn-position-actions">
                <button type="button" disabled={busy || !config || claimable === 0n} onClick={() => onClaim(BigInt(position.id))}>Claim WETH</button>
                <button type="button" disabled={busy || !config || claimable === 0n || !state.reinvestment?.available} onClick={() => setSelected(selected === position.id ? null : position.id)} aria-expanded={selected === position.id}>Buy more and stake</button>
                {!position.withdrawn && <button type="button" disabled={busy || !config || phase !== 'unlocked'} onClick={() => onUnbond(BigInt(position.id))}>Withdraw $MUPPETS</button>}
              </div>
              {selected === position.id && config && <RewardReinvestment key={`${walletAddress}-${position.id}`} config={config} account={walletAddress as Address} metadata={state.reinvestment} positionId={BigInt(position.id)} agentKey={position.key} claimable={claimable} availableBoundKeys={keyPosition?.availableBoundKeys ?? 0n} busy={busy} onBusy={onBusy} onConfirmed={onConfirmed} />}
            </article>
          })}</div>
        )}
        {(positionCursor > 0 || earn?.next_position_cursor != null) && <nav className="earn-pagination" aria-label="Bond pages"><button type="button" disabled={busy || positionCursor === 0} onClick={() => onCursor(Math.max(0, positionCursor - 50))}>Previous bonds</button><button type="button" disabled={busy || !cursorReady || earn?.next_position_cursor == null} onClick={() => { if (earn?.next_position_cursor != null) onCursor(earn.next_position_cursor) }}>Next bonds</button></nav>}
      </section>

      <section className="earn-history" aria-label="Your reward history">
        <header className="earn-section-header"><h2>Your reward history</h2><span>Confirmed transactions</span></header>
        {!earn || earn.receipt_status === 'unavailable' ? <p>Reward history is unavailable. No missing records are treated as zero.</p> : earn.receipt_status === 'activation_pending' ? <p>Reward history begins after contract activation.</p> : earn.receipts.length === 0 ? <p>No reward receipts in the checked history.</p> : (
          <div className="earn-receipt-list">{earn.receipts.map((receipt) => <article key={`${receipt.tx_hash}-${receipt.log_index}`}>
            <header><h3>{receipt.kind === 'reinvested' ? 'Rewards claimed and reinvested' : 'Rewards claimed'}</h3><a href={receipt.url} target="_blank" rel="noreferrer">View receipt ↗</a></header>
            <p>Position #{receipt.position_id} · {date(receipt.timestamp)}</p>
            <dl><div><dt>Total claimed</dt><dd>{formatEarnAmount(receipt.claimed_weth_raw, 'WETH')}</dd></div><div><dt>Received in wallet</dt><dd>{formatEarnAmount(receipt.received_weth_raw, 'WETH')}</dd></div><div><dt>Used to reinvest</dt><dd>{formatEarnAmount(receipt.reinvested_weth_raw, 'WETH')}</dd></div></dl>
            <p className="earn-footnote">Sources: global fees {formatEarnAmount(receipt.global_weth_raw, 'WETH')} · Key fees {formatEarnAmount(receipt.key_weth_raw, 'WETH')}{receipt.key && ` (${shortenAddress(receipt.key)})`}</p>
          </article>)}</div>
        )}
        {earn?.receipt_range && <p className="earn-footnote">Checked blocks {earn.receipt_range.from_block.toLocaleString('en-US')} to {earn.receipt_range.to_block.toLocaleString('en-US')}.{!earn.receipt_range.complete_from_deployment && ' Older history is outside this view.'}{earn.receipts_truncated && ' Showing the latest matching receipts.'} Lifetime totals above come from contract counters, not this limited list.</p>}
      </section>
    </div>
  )
}

export function EarnWeeks({ state }: { state: EarnWeeksState | undefined }) {
  return <section className="earn-weeks" aria-label="Weekly fee record">
    <header className="earn-section-header"><h2>Weekly fee record</h2><span>Week received by the router</span></header>
    <p>Each fee stays attached to its receipt week, even if distribution happens later. Pons escrow does not reveal the original trade week.</p>
    {!state || state.status !== 'available' ? <p>{state?.reason ?? 'Weekly accounting is awaiting verified deployment.'}</p> : state.rows.length === 0 ? <p>No fee weeks recorded yet.</p> : <div className="earn-week-list">{state.rows.map((week) => <article key={`${week.source}-${week.source_key}-${week.epoch}`}>
      <header><h3>{date(week.starts_at)} to {date(week.ends_at)}</h3><span>{week.source === 'global' ? 'Global fees' : `Key ${shortenAddress(week.source_key ?? '')}`} · {week.finalized_at == null ? 'Not distributed yet' : 'Finalized'}</span></header>
      <dl><div><dt>Fees received</dt><dd>{formatEarnAmount(week.received_wei, 'ETH')}</dd></div><div><dt>WETH delivered</dt><dd>{formatEarnAmount(week.bond_rewards_delivered_wei, 'WETH')}</dd></div><div><dt>Unallocated reward share</dt><dd>{formatEarnAmount(week.unallocated_bond_rewards_wei, 'ETH')}</dd></div></dl>
    </article>)}</div>}
    {state?.has_more && <p>Showing a limited set of recent receipt weeks. Older weeks remain in the contract.</p>}
    {state?.contract_url && <a href={state.contract_url} target="_blank" rel="noreferrer">Inspect the revenue contract ↗</a>}
    <p className="earn-footnote">A week with no eligible holders leaves its reward share held for that original week. It cannot pay later holders, and the contract has no recovery route for that balance. Treasury funding is excluded from fees.</p>
  </section>
}

function date(timestamp: number): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(timestamp * 1000)) + ' UTC'
}
