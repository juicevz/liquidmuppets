import { useEffect, useState } from 'react'
import { formatEther, type Address, type Hash } from 'viem'
import { Icon } from '../components/Icon'
import { RewardReinvestment } from '../components/RewardReinvestment'
import { EarnWallet, EarnWeeks } from '../components/EarnWallet'
import { formatEarnAmount } from '../lib/earn'
import { fetchRevenue, type ProtocolConfig, type RevenueState } from '../lib/api'
import { shortenAddress } from '../lib/format'
import { useProtocol } from '../hooks/useProtocol'
import { getInjectedProvider } from '../lib/protocol'
import {
  bindKeys,
  bondAgentKeyUnit,
  claimAgentBondPositionRewards,
  readAgentBondKeyPosition,
  unbondAgentPosition,
  type AgentBondTerm,
  type AgentBondKeyPosition,
  type ChainAgent,
} from '../lib/protocol'

interface RevenuePageProps {
  walletAddress?: string
  onConnect: () => Promise<void>
}

export function RevenuePage({ walletAddress, onConnect }: RevenuePageProps) {
  const [state, setState] = useState<RevenueState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [positions, setPositions] = useState<Record<string, AgentBondKeyPosition>>({})
  const [action, setAction] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionReceipts, setActionReceipts] = useState<Hash[]>([])
  const [positionCursor, setPositionCursor] = useState(0)
  const protocol = useProtocol(walletAddress, Boolean(walletAddress && state?.wallet?.available && state?.bond.deployed))

  useEffect(() => { setPositionCursor(0); setActionReceipts([]); setActionError('') }, [walletAddress])

  useEffect(() => {
    let active = true
    let running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const next = await fetchRevenue(walletAddress, positionCursor)
        if (!active) return
        setState(next)
        setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Revenue evidence is reconnecting.')
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
  }, [walletAddress, refreshToken, positionCursor])

  useEffect(() => {
    if (!state?.wallet?.available || !state.bond.deployed || !walletAddress || !protocol.config || !protocol.snapshot) {
      setPositions({})
      return undefined
    }
    let active = true
    Promise.all(protocol.snapshot.agents.map(async (agent) => [
      agent.key.address.toLowerCase(),
      await readAgentBondKeyPosition(protocol.config!, walletAddress as Address, agent.key.address),
    ] as const))
      .then((rows) => {
        if (active) setPositions(Object.fromEntries(rows))
      })
      .catch((reason) => {
        if (active) setActionError(reason instanceof Error ? reason.message : 'Agent Bond positions are reconnecting.')
      })
    return () => { active = false }
  }, [protocol.config, protocol.snapshot, state?.wallet?.available, state?.bond.deployed, walletAddress])

  if (loading && !state) {
    return <div className="app-page revenue-page revenue-state"><Icon name="clock" /><p>Loading your rewards.</p></div>
  }

  if (!state) {
    return <div className="app-page revenue-page revenue-state" role="alert"><Icon name="alert" /><h1>Earn is reconnecting.</h1><p>{error}</p></div>
  }

  const isLive = state.status === 'live'
  const walletAgents = protocol.snapshot?.agents.filter((agent) => {
    const position = positions[agent.key.address.toLowerCase()]
    return agent.key.walletBalance > 0n || agent.key.walletBound > 0n || (position?.committedUnits ?? 0n) > 0n
  }) ?? []

  const runAction = async (label: string, task: () => Promise<Hash[]>) => {
    setAction(label)
    setActionError('')
    setActionReceipts([])
    try {
      const receipts = await task()
      setActionReceipts(receipts)
      protocol.refresh()
      setRefreshToken((value) => value + 1)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'The wallet transaction did not complete.')
    } finally {
      setAction('')
    }
  }

  const actionContext = () => {
    const provider = getInjectedProvider()
    if (!provider) throw new Error('No injected wallet found.')
    if (!walletAddress || !protocol.config) throw new Error('Connect a wallet and wait for protocol configuration.')
    return { provider, account: walletAddress as Address, config: protocol.config }
  }

  return (
    <div className="app-page revenue-page">
      <nav className="earn-tabs" aria-label="Earn features"><a href="/app/earn" aria-current="page">Agent Bonds</a><a href="/app/stock-drops">Stock Drops</a></nav>
      <header className="revenue-hero">
        <div>
          <span className="revenue-kicker"><i aria-hidden="true" />your wallet and rewards</span>
          <h1>Earn.</h1>
          <p>Your staked $MUPPETS, WETH rewards and upcoming unlocks, together.</p>
        </div>
        <div className={`revenue-release-state ${isLive ? 'is-live' : 'is-pending'}`}>
          <small>{isLive ? 'mainnet state' : 'release state'}</small>
          <strong>{isLive ? 'active' : state.bond.deployed ? 'new bonds unavailable' : 'activation pending'}</strong>
          <p>{isLive ? 'Rewards depend on collected fees and your eligible share. They can be zero.' : state.bond.deployed ? 'New bonds are unavailable. Existing claims and unlocked withdrawals remain available.' : 'Staking and reward payouts are not active yet. No wallet deposit is needed to browse.'}</p>
        </div>
      </header>

      {error && <div className="pulse-error" role="status"><Icon name="alert" />{error}</div>}

      <EarnWallet
        walletAddress={walletAddress}
        state={state}
        config={protocol.config}
        keyPositions={positions}
        agents={protocol.snapshot?.agents ?? []}
        busy={Boolean(action) || Boolean(error)}
        positionCursor={positionCursor}
        onCursor={setPositionCursor}
        onConnect={onConnect}
        onBusy={(isBusy) => setAction(isBusy ? 'reinvest' : '')}
        onConfirmed={(hash) => { setActionReceipts([hash]); protocol.refresh(); setRefreshToken((value) => value + 1) }}
        onClaim={(id) => void runAction(`claim-${id}`, async () => {
          const { config, provider, account } = actionContext()
          return [await claimAgentBondPositionRewards(config, provider, account, id)]
        })}
        onUnbond={(id) => void runAction(`unbond-${id}`, async () => {
          const { config, provider, account } = actionContext()
          return [await unbondAgentPosition(config, provider, account, id)]
        })}
      />
      {(actionError || actionReceipts.length > 0) && <div className={`revenue-action-result ${actionError ? 'is-error' : ''}`} role="status">{actionError || 'Transaction confirmed.'}{actionReceipts.map((hash) => <a href={`${state.network.explorer_url}/tx/${hash}`} target="_blank" rel="noreferrer" key={hash}>View receipt <Icon name="arrow" /></a>)}</div>}

      <details className="earn-advanced">
      <summary>Protocol details</summary>

      <section className="revenue-summary" aria-label="Revenue summary">
        <span><small>reward unit</small><strong>15,000 $MUPPETS + 1 Key</strong></span>
        <span><small>distribution</small><strong>weekly WETH</strong></span>
        <span><small>reward units</small><strong>{state.bond.total_reward_units == null ? 'Unavailable' : formatInteger(BigInt(state.bond.total_reward_units))}</strong></span>
        <span><small>routed revenue</small><strong>{formatEarnAmount(state.router.total_revenue_routed, 'ETH')}</strong></span>
        <span><small>WETH delivered</small><strong>{formatEarnAmount(state.router.total_bond_rewards_delivered, 'WETH')}</strong></span>
      </section>

      <EarnWeeks state={state.earn_weeks} />

      <section className="revenue-reinvest-intro" aria-labelledby="reward-choice-title">
        <div><small>your rewards, your choice</small><h2 id="reward-choice-title">Claim WETH or buy more and stake.</h2><p>Keep your earned WETH, or choose an amount to buy $MUPPETS and open a new bond in one transaction. Review the quote, minimum received, gas and lock before signing.</p></div>
        <div><strong>{state.reinvestment?.available ? 'Choose a position below' : 'Reinvestment activation pending'}</strong><p>Each new bond needs 15,000 purchased $MUPPETS and one unused, permanently bound Key. Leftovers return to your wallet. Existing bond locks stay unchanged.</p>{!state.reinvestment?.available && <button type="button" disabled>Buy more and stake · pending</button>}</div>
      </section>

      <section className="revenue-route" aria-labelledby="revenue-route-title">
        <header>
          <div><small>target route · total token trade fee stays 3%</small><h2 id="revenue-route-title">Where the fee goes</h2></div>
          <p>The router receives the creator portion after Pons handles its protocol share and built-in buyback. Key-market fees are recorded as a separate source.</p>
        </header>
        <div className="revenue-route-grid">
          {state.target_fee_route.map((route, index) => (
            <article className={`revenue-route-${route.id}`} key={route.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{route.percent}</strong>
              <p>{route.label}</p>
            </article>
          ))}
        </div>
        <div className="revenue-router-split">
          <span><small>creator revenue enters router</small><strong>2.350%</strong></span>
          <i aria-hidden="true" />
          <span><small>Agent Bonds</small><strong>{state.router_split.agent_bonds}</strong></span>
          <span><small>Stock reserve</small><strong>{state.router_split.stock_reserve}</strong></span>
          <span><small>keeper + ops</small><strong>{state.router_split.operations}</strong></span>
        </div>
      </section>

      <section className="revenue-route revenue-key-route" aria-labelledby="key-revenue-route-title">
        <header>
          <div><small>V2 Agent Key fees · exact Key attribution</small><h2 id="key-revenue-route-title">One Key, one revenue lane</h2></div>
          <p>Each V2 fill records its Key, volume and fee before the weekly route. Legacy marketplace fees stay global because the old transfer contains no Key address.</p>
        </header>
        <div className="key-revenue-split revenue-key-split">
          <span><b>{state.key_market_split.agent_bond_weth}</b>WETH to bonds using that Key</span>
          <span><b>{state.key_market_split.muppets_buyback}</b>$MUPPETS buyback</span>
          <span><b>{state.key_market_split.stock_token_reserve}</b>Stock Token reserve</span>
          <span><b>{state.key_market_split.operations}</b>operations</span>
        </div>
        <div className="revenue-key-rule">
          <span><small>cadence</small><strong>{state.key_market_split.cadence}</strong></span>
          <span><small>buyback custody</small><strong>{state.key_market_split.vesting}</strong></span>
          <span><small>history</small><strong>since V2 tracking begins</strong></span>
        </div>
      </section>

      <div className="revenue-two-column">
        <section className="revenue-bond" aria-labelledby="revenue-bond-title">
          <header><small>one unit at a time</small><h2 id="revenue-bond-title">Agent Bond</h2></header>
          <ol>
            <li><span>01</span><div><strong>Bind one Agent Key</strong><p>Binding is permanent. The Key becomes non-transferable and remains separate from vault ownership.</p></div></li>
            <li><span>02</span><div><strong>Choose a fixed term</strong><p>Lock for 30 days at 1x, 90 days at 1.25x, or 180 days at 1.5x. Bonded tokens still count toward FactoryV2 Creator Slots.</p></div></li>
            <li><span>03</span><div><strong>Complete epochs and claim</strong><p>Every position matures for seven days and earns only for full completed weekly epochs. A zero-revenue epoch pays zero.</p></div></li>
          </ol>
          <div className="revenue-wallet-card">
            {!walletAddress ? (
              <><span><Icon name="wallet" />wallet position</span><p>Connect to read your reward units and pending WETH.</p><button type="button" onClick={() => void onConnect()}>Connect Rabby</button></>
            ) : !state.wallet?.available ? (
              <><span><Icon name="wallet" />{shortenAddress(walletAddress)}</span><p>Agent Bond transactions remain unavailable until the verified mainnet contracts are configured and active.</p><button type="button" disabled>Activation pending</button></>
            ) : (
              <>
                <span><Icon name="wallet" />{shortenAddress(walletAddress)}</span>
                <div className="revenue-wallet-values">
                  <b><small>units</small>{state.wallet.reward_units ?? '0'}</b>
                  <b><small>bonded</small>{formatTokenRaw(state.wallet.bonded_muppets_raw ?? '0')} $MUPPETS</b>
                  <b><small>claimable</small>{formatNative(BigInt(state.wallet.pending_weth_raw ?? '0'))} WETH</b>
                </div>
                <p>Binding is permanent. Every bond waits seven days, then earns only during full completed epochs. Claim and withdrawal actions stay attached to each position below.</p>
              </>
            )}
          </div>
          {walletAddress && state.wallet?.available && state.bond.deployed && (
            <div className="revenue-agent-controls">
              <header><span>eligible Agent Keys</span><small>one bound Key per unit</small></header>
              {walletAgents.map((agent) => (
                <RevenueAgentControl
                  agent={agent}
                  position={positions[agent.key.address.toLowerCase()]}
                  busy={Boolean(action)}
                  action={action}
                  canBond={isLive && state.bond.paused === false}
                  reinvestment={state.reinvestment}
                  config={protocol.config}
                  account={walletAddress as Address}
                  onReinvestBusy={(isBusy) => setAction(isBusy ? `reinvest-${agent.key.address}` : '')}
                  onReinvestConfirmed={(hash) => {
                    setActionError('')
                    setActionReceipts([hash])
                    protocol.refresh()
                    setRefreshToken((value) => value + 1)
                  }}
                  onBind={() => {
                    if (!window.confirm('Binding one Agent Key is permanent. Continue?')) return
                    void runAction(`bind-${agent.key.address}`, async () => {
                      const { config, provider, account } = actionContext()
                      return [await bindKeys(config, provider, account, agent, 1)]
                    })
                  }}
                  onBond={(term) => void runAction(`bond-${agent.key.address}`, async () => {
                    const { config, provider, account } = actionContext()
                    return bondAgentKeyUnit(config, provider, account, agent.key.address, term)
                  })}
                  onUnbond={(positionId) => void runAction(`unbond-${positionId}`, async () => {
                    const { config, provider, account } = actionContext()
                    return [await unbondAgentPosition(config, provider, account, positionId)]
                  })}
                  onClaim={(positionId) => void runAction(`claim-${positionId}`, async () => {
                    const { config, provider, account } = actionContext()
                    return [await claimAgentBondPositionRewards(config, provider, account, positionId)]
                  })}
                  key={agent.key.address}
                />
              ))}
              {!protocol.loading && walletAgents.length === 0 && <p>No transferable or bound Agent Key was found in this wallet.</p>}
              {(protocol.loading || (walletAgents.length > 0 && Object.keys(positions).length === 0)) && <p>Reading Agent Key positions.</p>}
            </div>
          )}
          {(actionError || actionReceipts.length > 0) && (
            <div className={`revenue-action-result ${actionError ? 'is-error' : ''}`} role="status">
              {actionError || 'Transaction confirmed.'}
              {!actionError && actionReceipts.map((hash) => <a href={`${state.network.explorer_url}/tx/${hash}`} target="_blank" rel="noreferrer" key={hash}>{shortenAddress(hash)} <Icon name="arrow" /></a>)}
            </div>
          )}
        </section>

        <section className="revenue-evidence" aria-labelledby="revenue-evidence-title">
          <header><small>current chain evidence</small><h2 id="revenue-evidence-title">Activation record</h2></header>
          <div className="revenue-checks">
            {state.activation_checks.map((check) => <span className={check.complete ? 'complete' : ''} key={check.label}><i aria-hidden="true" />{check.label}<b>{check.complete ? 'confirmed' : 'pending'}</b></span>)}
          </div>
          <dl className="revenue-pons-state">
            <div><dt>Pons read</dt><dd>{state.pons.available ? `block ${state.pons.block_number?.toLocaleString()}` : 'unavailable'}</dd></div>
            <div><dt>current creator revenue</dt><dd>{state.pons.current_creator_revenue ?? 'unavailable'}</dd></div>
            <div><dt>built-in buyback</dt><dd>{state.pons.buyback_enabled ? 'enabled' : 'off'}</dd></div>
            <div><dt>fee recipient</dt><dd>{state.pons.creator_fee_recipient ? shortenAddress(state.pons.creator_fee_recipient) : 'unavailable'}</dd></div>
          </dl>
          <p className="revenue-observed">{state.pons.observed_at ? `Observed ${formatUtc(state.pons.observed_at)}.` : state.pons.error}</p>
          <div className="revenue-contract-links">
            {contractLink(state.network.explorer_url, state.contracts.revenue_router, 'Revenue Router')}
            {contractLink(state.network.explorer_url, state.contracts.agent_bond, 'Agent Bond')}
            {contractLink(state.network.explorer_url, state.contracts.buyback_vault, 'Buyback vault')}
            {contractLink(state.network.explorer_url, state.contracts.stock_reserve, 'Stock reserve')}
            {contractLink(state.network.explorer_url, state.contracts.pons_fee_policy, 'Pons fee policy')}
          </div>
        </section>
      </div>

      <section className="revenue-receipts" aria-labelledby="revenue-receipts-title">
        <header>
          <div><small>since tracking began</small><h2 id="revenue-receipts-title">Revenue receipts</h2></div>
          <span>{state.tracking_started_at ? formatUtc(state.tracking_started_at) : 'starts at contract deployment'}</span>
        </header>
        {state.receipts.length > 0 ? (
          <div>{state.receipts.map((receipt) => <a href={receipt.url} target="_blank" rel="noreferrer" key={receipt.tx_hash}><span><i aria-hidden="true" />{receipt.action}</span><b>block {receipt.block_number.toLocaleString()}</b><small>{formatUtc(receipt.timestamp)} · {shortenAddress(receipt.tx_hash)}</small><Icon name="arrow" /></a>)}</div>
        ) : (
          <div className="revenue-empty"><Icon name="receipt" /><strong>No revenue receipt yet.</strong><p>The page will begin at the deployment block. It does not backfill a pretend reward history or APY.</p></div>
        )}
      </section>

      <section className="revenue-boundary">
        <span>read this first</span>
        <div>{state.boundaries.map((boundary) => <p key={boundary}><i aria-hidden="true" />{boundary}</p>)}</div>
      </section>
      </details>
    </div>
  )
}

function RevenueAgentControl({
  agent,
  position,
  busy,
  action,
  canBond,
  onBind,
  onBond,
  onUnbond,
  onClaim,
  reinvestment,
  config,
  account,
  onReinvestBusy,
  onReinvestConfirmed,
}: {
  agent: ChainAgent
  position?: AgentBondKeyPosition
  busy: boolean
  action: string
  canBond: boolean
  onBind: () => void
  onBond: (term: AgentBondTerm) => void
  onUnbond: (positionId: bigint) => void
  onClaim: (positionId: bigint) => void
  reinvestment: RevenueState['reinvestment']
  config: ProtocolConfig | null
  account: Address
  onReinvestBusy: (busy: boolean) => void
  onReinvestConfirmed: (hash: Hash) => void
}) {
  const actionId = agent.key.address
  const [term, setTerm] = useState<AgentBondTerm>(0)
  const [reinvestPosition, setReinvestPosition] = useState<bigint | null>(null)
  const now = Math.floor(Date.now() / 1_000)
  return (
    <article>
      <div><strong>{agent.name}</strong><small>${agent.key.symbol} · {shortenAddress(agent.key.address)}</small></div>
      <span><small>transferable</small><b>{agent.key.walletBalance.toString()}</b></span>
      <span><small>bound free</small><b>{position?.availableBoundKeys.toString() ?? '…'}</b></span>
      <span><small>committed units</small><b>{position?.committedUnits.toString() ?? '…'}</b></span>
      <span><small>claimable WETH</small><b>{position ? formatNative(position.pendingGlobalReward + position.pendingKeyReward) : '…'}</b></span>
      <div className="revenue-agent-actions">
        {(position?.availableBoundKeys ?? 0n) > 0n ? (
          <>
            <label>
              <span>bond term</span>
              <select value={term} disabled={busy || !canBond} onChange={(event) => setTerm(Number(event.target.value) as AgentBondTerm)}>
                <option value={0}>30 days · 1x</option>
                <option value={1}>90 days · 1.25x</option>
                <option value={2}>180 days · 1.5x</option>
              </select>
            </label>
            <button type="button" disabled={busy || !canBond} onClick={() => {
              if (!window.confirm(`Lock 15,000 $MUPPETS for ${termLabel(term)} with no early exit?`)) return
              onBond(term)
            }}>{action === `bond-${actionId}` ? 'Waiting' : 'Bond 15,000'}</button>
          </>
        ) : agent.key.walletBalance > 0n ? (
          <button type="button" disabled={busy || !canBond} onClick={onBind}>{action === `bind-${actionId}` ? 'Waiting' : 'Bind 1 Key'}</button>
        ) : null}
      </div>
      {(position?.positions.length ?? 0) > 0 && (
        <div className="revenue-bond-positions">
          {position!.positions.map((bondPosition) => {
            const claimable = bondPosition.pendingGlobalReward + bondPosition.pendingKeyReward
            const unlockReady = !bondPosition.withdrawn && bondPosition.unlockAt <= now
            const state = bondPosition.withdrawn
              ? 'withdrawn'
              : now < bondPosition.maturesAt
                ? `matures ${shortDate(bondPosition.maturesAt)}`
                : now < bondPosition.unlockAt
                  ? now < bondPosition.firstEligibleEpoch * 7 * 86400
                    ? 'waiting for first full week'
                    : now >= bondPosition.lastEligibleEpochExclusive * 7 * 86400
                      ? 'final eligible week complete'
                      : 'epoch eligible'
                  : 'unlocked'
            return (
              <div key={bondPosition.id.toString()}>
                <span><small>position #{bondPosition.id.toString()}</small><b>{termLabel(bondPosition.term)} · {formatWeight(bondPosition.multiplierBps)}</b></span>
                <span><small>state</small><b>{state}</b></span>
                <span><small>claimable</small><b>{formatNative(claimable)} WETH</b></span>
                <div>
                  {claimable > 0n && <button className="secondary" type="button" disabled={busy} onClick={() => onClaim(bondPosition.id)}>{action === `claim-${bondPosition.id}` ? 'Waiting' : 'Claim WETH'}</button>}
                  {claimable > 0n && <button className="secondary" type="button" disabled={busy} onClick={() => setReinvestPosition(reinvestPosition === bondPosition.id ? null : bondPosition.id)} aria-expanded={reinvestPosition === bondPosition.id}>Buy more and stake</button>}
                  {!bondPosition.withdrawn && <button className="secondary" type="button" disabled={busy || !unlockReady} onClick={() => onUnbond(bondPosition.id)} title={unlockReady ? 'Return bonded MUPPETS' : `Unlocks ${formatUtc(new Date(bondPosition.unlockAt * 1_000).toISOString())}`}>{action === `unbond-${bondPosition.id}` ? 'Waiting' : unlockReady ? 'Unbond' : `Until ${shortDate(bondPosition.unlockAt)}`}</button>}
                </div>
                {reinvestPosition === bondPosition.id && config && <RewardReinvestment
                  key={`${account}-${bondPosition.id}`}
                  config={config}
                  account={account}
                  metadata={reinvestment}
                  positionId={bondPosition.id}
                  agentKey={agent.key.address}
                  claimable={claimable}
                  availableBoundKeys={position!.availableBoundKeys}
                  busy={busy}
                  onBusy={onReinvestBusy}
                  onConfirmed={onReinvestConfirmed}
                />}
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function termLabel(term: AgentBondTerm): string {
  if (term === 1) return '90 days'
  if (term === 2) return '180 days'
  return '30 days'
}

function formatWeight(multiplierBps: number): string {
  return `${(multiplierBps / 10_000).toFixed(multiplierBps % 10_000 === 0 ? 0 : 2)}x`
}

function contractLink(explorer: string, address: string | null, label: string) {
  if (!address) return <span className="is-pending" key={label}>{label} · pending</span>
  return <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" key={label}>{label} <Icon name="arrow" /></a>
}

function formatNative(value: bigint): string {
  const [whole, fraction = ''] = formatEther(value).split('.')
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function formatTokenRaw(value: string): string {
  const whole = BigInt(value) / 10n ** 18n
  return whole.toLocaleString('en-US')
}

function formatInteger(value: bigint): string {
  return value.toLocaleString('en-US')
}

function formatUtc(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC'
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(timestamp * 1_000))
}
