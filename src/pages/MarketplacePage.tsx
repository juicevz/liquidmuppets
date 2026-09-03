import { useEffect, useMemo, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { Icon } from '../components/Icon'
import { getPet } from '../data/pets'
import { useProtocol } from '../hooks/useProtocol'
import {
  bindKeys,
  buyFloorKeys,
  depositToVault,
  formatAsset,
  formatEthValue,
  getInjectedProvider,
  listKeys,
  placeKeyOffer,
  recallAgent,
  recenterRange,
  redeemAll,
  runAgentCycle,
  sellIntoTopBid,
  taskForAgent,
  type ChainAgent,
} from '../lib/protocol'
import type { StrategyTaskId } from '../types'
import { fetchActivity, type ActivityItem } from '../lib/api'

interface MarketplacePageProps {
  walletAddress?: string
  onConnect: () => void
}

type TaskFilter = 'all' | StrategyTaskId
type KeyAction = 'buy' | 'list' | 'offer' | 'sell' | 'bind'

export function MarketplacePage({ walletAddress, onConnect }: MarketplacePageProps) {
  const { config, snapshot, tasks, loading, error, refresh } = useProtocol(walletAddress)
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<bigint | null>(null)
  const agents = snapshot?.agents ?? []
  const selected = agents.find((agent) => agent.id === selectedId) ?? null
  const listedKeys = agents.reduce((sum, agent) => sum + agent.key.listed, 0n)
  const boundKeys = agents.reduce((sum, agent) => sum + agent.key.totalBound, 0n)
  const listedPets = agents.filter((agent) => agent.key.listed > 0n).length
  const listedPercent = agents.length === 0 ? 0 : Math.round((listedPets / agents.length) * 100)
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return agents.filter((agent) => {
      const task = taskForAgent(tasks, agent)
      return (filter === 'all' || agent.taskId === filter)
        && (!normalized || `${agent.name} ${agent.key.symbol} ${task?.label ?? ''}`.toLowerCase().includes(normalized))
    })
  }, [agents, filter, query, tasks])

  return (
    <div className="app-page marketplace-page live-marketplace-page">
      <section className="app-page-heading">
        <div>
          <h1>Pet marketplace.</h1>
          <p>Browse pet vaults, Key asks and bids, ownership, and transaction receipts from live contracts.</p>
        </div>
        <div className="market-summary key-market-summary">
          <span><small>live agents</small><strong>{agents.length}</strong></span>
          <span><small>listed Keys</small><strong>{listedKeys.toString()}</strong></span>
          <span><small>bound Keys</small><strong>{boundKeys.toString()}</strong></span>
          <span><small>pets listed</small><strong>{listedPercent}%</strong></span>
        </div>
      </section>

      {error && <div className="protocol-error" role="alert"><Icon name="alert" />{error}<button type="button" onClick={refresh}>Retry</button></div>}
      {!config?.factory && !loading && <div className="deployment-pending"><Icon name="lock" /><span><strong>Contracts are not available yet.</strong> The marketplace will open when verified deployment addresses reach the API.</span></div>}

      <section className="market-controls">
        <div className="category-tabs" role="group" aria-label="Filter by type of task">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>all tasks</button>
          {tasks.map((task) => <button type="button" className={filter === task.id ? 'active' : ''} onClick={() => setFilter(task.id)} key={task.id}>{task.label}</button>)}
        </div>
        <label className="market-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pet, Key, or task" /></label>
        <button type="button" className="chain-refresh" onClick={refresh} disabled={loading}><Icon name="spark" />{loading ? 'Reading chain' : 'Refresh'}</button>
      </section>

      <div className="marketplace-workspace">
        <div className="marketplace-listings">
          {visible.length > 0 && <ChainMarketBoard agents={visible} tasks={tasks} onSelect={(agent) => setSelectedId(agent.id)} />}

          <section className="live-agent-grid" aria-live="polite">
            {visible.map((agent) => {
              const pet = getPet(agent.petId)
              const task = taskForAgent(tasks, agent)
              return (
                <button type="button" className="live-agent-card" onClick={() => setSelectedId(agent.id)} key={agent.id.toString()}>
                  <div className="live-agent-portrait"><img src={pet.portrait} alt={`${pet.name} pet`} /><span>#{agent.id.toString()}</span></div>
                  <div className="live-agent-card-head"><span><strong>{agent.name}</strong><small>${agent.key.symbol}</small></span><em>{task?.label}</em></div>
                  <div className="live-agent-card-stats">
                    <span><small>Key floor</small><strong>{formatEthValue(agent.key.floorWei)}</strong></span>
                    <span><small>vault</small><strong>{formatAsset(agent.vault.totalAssets, agent.vault.assetDecimals)} {agent.vault.assetSymbol}</strong></span>
                    <span><small>in pool</small><strong>{agent.vault.totalAssets === 0n ? '0%' : `${Number(agent.vault.deployedAssets * 10_000n / agent.vault.totalAssets) / 100}%`}</strong></span>
                    <span><small>listed</small><strong>{agent.key.listed.toString()}</strong></span>
                  </div>
                  <span className="open-agent-link">Open market + vault <Icon name="arrow" /></span>
                </button>
              )
            })}
          </section>

          {!loading && config?.factory && visible.length === 0 && (
            <div className="market-empty"><Icon name="search" /><h2>No Muppets onchain yet.</h2><p>Launch the first one, choose its task, and set the first Key ask.</p></div>
          )}
        </div>
        <ActivityRail explorerUrl={config?.explorerUrl} enabled={!loading} />
      </div>

      {selected && config && <LiveAgentDrawer agent={selected} config={config} feeBps={snapshot?.feeBps ?? 300} tasks={tasks} walletAddress={walletAddress} onConnect={onConnect} onClose={() => setSelectedId(null)} onRefresh={refresh} />}
    </div>
  )
}

function ActivityRail({ explorerUrl, enabled }: { explorerUrl?: string; enabled: boolean }) {
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    const load = () => {
      fetchActivity(40)
        .then((rows) => {
          if (!active) return
          setActivity(rows)
          setFailed(false)
        })
        .catch(() => { if (active) setFailed(true) })
    }
    load()
    const timer = window.setInterval(load, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [enabled])

  return (
    <aside className="public-activity-rail" aria-label="Public onchain activity">
      <div className="activity-rail-head">
        <div>Recent activity</div>
      </div>
      <div className="activity-rail-list" aria-live="polite">
        {activity.map((item) => (
          <a
            className={`public-activity-item activity-${item.direction}`}
            href={explorerUrl ? `${explorerUrl}/tx/${item.tx_hash}` : undefined}
            target="_blank"
            rel="noreferrer"
            key={item.id}
          >
            <span className="activity-actor">{item.handle ? `@${item.handle}` : short(item.actor)}</span>
            <span className="activity-copy">
              {item.action}{item.quantity ? ` ${item.quantity}` : ''}{item.key_symbol ? ` $${item.key_symbol}` : ''}
              {item.agent_name ? <strong>{item.agent_name}</strong> : null}
            </span>
            {item.value && <b className="activity-value">{item.value} {item.value_symbol}</b>}
            <time dateTime={item.timestamp}>{timeAgo(item.timestamp)}</time>
          </a>
        ))}
        {!failed && activity.length === 0 && (
          <div className="activity-empty"><Icon name="spark" /><span>The first real launch, deposit or Key trade will print here.</span></div>
        )}
        {failed && <div className="activity-empty"><Icon name="alert" /><span>Recent activity is reconnecting.</span></div>}
      </div>
    </aside>
  )
}

function timeAgo(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

function ChainMarketBoard({ agents, tasks, onSelect }: { agents: ChainAgent[]; tasks: ReturnType<typeof useProtocol>['tasks']; onSelect: (agent: ChainAgent) => void }) {
  return (
    <section className="key-market-board live-key-board" aria-label="Live Agent Key markets">
      <div className="key-market-board-head"><span>Muppet / Key</span><span>task</span><span>vault assets</span><span>floor</span><span>top bid</span><span>listed</span><span>supply</span></div>
      {agents.map((agent) => {
        const pet = getPet(agent.petId)
        const task = taskForAgent(tasks, agent)
        return (
          <button type="button" className="key-market-row" onClick={() => onSelect(agent)} key={agent.id.toString()}>
            <span className="key-market-agent"><img src={pet.portrait} alt="" /><span><strong>{agent.name}</strong><small>${agent.key.symbol}</small></span></span>
            <strong>{task?.label ?? 'unknown'}</strong>
            <strong>{formatAsset(agent.vault.totalAssets, agent.vault.assetDecimals)} {agent.vault.assetSymbol}</strong>
            <strong>{formatEthValue(agent.key.floorWei)}</strong>
            <strong>{formatEthValue(agent.key.topBidWei)}</strong>
            <span>{agent.key.listed.toString()}</span>
            <span>{agent.key.supply.toString()}</span>
          </button>
        )
      })}
    </section>
  )
}

interface DrawerProps {
  agent: ChainAgent
  config: NonNullable<ReturnType<typeof useProtocol>['config']>
  feeBps: number
  tasks: ReturnType<typeof useProtocol>['tasks']
  walletAddress?: string
  onConnect: () => void
  onClose: () => void
  onRefresh: () => void
}

function LiveAgentDrawer({ agent, config, feeBps, tasks, walletAddress, onConnect, onClose, onRefresh }: DrawerProps) {
  const [vaultAmount, setVaultAmount] = useState(agent.vault.assetDecimals === 18 ? '0.1' : '100')
  const [keyAction, setKeyAction] = useState<KeyAction>('buy')
  const [quantity, setQuantity] = useState('1')
  const [keyPrice, setKeyPrice] = useState(agent.key.floorWei === null ? '0.01' : (Number(agent.key.floorWei) / 1e18).toString())
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const pet = getPet(agent.petId)
  const task = taskForAgent(tasks, agent)
  const account = walletAddress as Address | undefined
  const provider = getInjectedProvider()
  const isCreator = account?.toLowerCase() === agent.creator.toLowerCase()
  const shouldRecenter = agent.taskId === 1 && agent.vault.deployedAssets > 0n
  const cycleLabel = shouldRecenter
    ? 'Recenter WETH range'
    : agent.taskId === 1
      ? 'Open WETH range'
      : agent.taskId === 2
        ? 'Stage launch reserve'
        : 'Allocate stable route'
  const routeNote = agent.taskId === 0
    ? 'USDG enters one immutable Morpho Blue market. APY is variable, can fall to zero, and withdrawal depends on available Morpho liquidity.'
    : agent.taskId === 1
      ? 'This is real concentrated liquidity. It can lose value versus holding WETH. EZManager currently charges 0.4% on entry, execution has up to 3% slippage, and returns are never guaranteed.'
      : 'This cycle only isolates WETH for a future reviewed launch route. It does not enter a token pool, collect fees, or promise yield.'
  const sharePrice = agent.vault.totalSupply === 0n
    ? 1
    : Number(formatUnits(
      agent.vault.totalAssets * (10n ** BigInt(agent.vault.shareDecimals)) / agent.vault.totalSupply,
      agent.vault.assetDecimals,
    ))

  const requireWallet = (): { account: Address; provider: NonNullable<typeof provider> } | null => {
    if (!account || !provider) {
      onConnect()
      return null
    }
    return { account, provider }
  }
  const perform = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setNotice('')
    setActionError('')
    try {
      await action()
      setNotice(`${label} settled. Reading the new onchain state…`)
      onRefresh()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : `${label} failed.`)
    } finally {
      setBusy('')
    }
  }
  const executeKeyAction = async () => {
    const wallet = requireWallet()
    if (!wallet) return
    const qty = Math.max(1, Math.floor(Number(quantity)))
    if (keyAction === 'buy') return perform('Key purchase', () => buyFloorKeys(config, wallet.provider, wallet.account, agent, qty, feeBps))
    if (keyAction === 'list') return perform('Key listing', () => listKeys(config, wallet.provider, wallet.account, agent, qty, keyPrice))
    if (keyAction === 'offer') return perform('Key offer', () => placeKeyOffer(config, wallet.provider, wallet.account, agent, qty, keyPrice, feeBps))
    if (keyAction === 'sell') return perform('Key sale', () => sellIntoTopBid(config, wallet.provider, wallet.account, agent, qty))
    return perform('Key binding', () => bindKeys(config, wallet.provider, wallet.account, agent, qty))
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <aside className="agent-drawer live-agent-drawer" role="dialog" aria-modal="true" aria-label={`${agent.name} vault and Key market`}>
        <div className="drawer-head drawer-head-close">
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close agent details"><Icon name="close" /></button>
        </div>
        <div className="drawer-agent">
          <div className="drawer-portrait"><img src={pet.portrait} alt="" /></div>
          <div><h2>{agent.name}</h2><p>${agent.key.symbol} · {task?.label}</p></div>
        </div>
        <div className="contract-links">
          <a href={`${config.explorerUrl}/address/${agent.vault.address}`} target="_blank" rel="noreferrer">vault {short(agent.vault.address)}</a>
          <a href={`${config.explorerUrl}/address/${agent.key.address}`} target="_blank" rel="noreferrer">Key {short(agent.key.address)}</a>
        </div>

        <section className="drawer-section live-vault-panel">
          <div className="drawer-section-head"><span>{agent.vault.symbol} vault</span><small>ERC-4626 share</small></div>
          <div className="key-overview-primary vault-overview-grid">
            <div><small>total assets</small><strong>{formatAsset(agent.vault.totalAssets, agent.vault.assetDecimals)} {agent.vault.assetSymbol}</strong></div>
            <div><small>in pool</small><strong>{formatAsset(agent.vault.deployedAssets, agent.vault.assetDecimals)}</strong></div>
            <div><small>idle</small><strong>{formatAsset(agent.vault.idleAssets, agent.vault.assetDecimals)}</strong></div>
            <div><small>share price</small><strong>{sharePrice.toFixed(6)} {agent.vault.assetSymbol}</strong></div>
          </div>
          <div className="wallet-vault-balances">
            <span><small>your deposit asset</small><strong>{formatAsset(agent.vault.walletAssetBalance, agent.vault.assetDecimals)} {agent.vault.assetSymbol}</strong></span>
            <span><small>your shares</small><strong>{formatAsset(agent.vault.walletShares, agent.vault.shareDecimals)} {agent.vault.symbol}</strong></span>
          </div>
          <div className="vault-action-form">
            <label><span>amount</span><input value={vaultAmount} onChange={(event) => setVaultAmount(event.target.value)} inputMode="decimal" /><b>{agent.vault.assetSymbol}</b></label>
            <div>
              <button type="button" disabled={Boolean(busy)} onClick={() => {
                const wallet = requireWallet(); if (wallet) void perform('Vault deposit', () => depositToVault(config, wallet.provider, wallet.account, agent, vaultAmount))
              }}>Deposit</button>
              <button type="button" disabled={Boolean(busy) || agent.vault.walletShares === 0n} onClick={() => {
                const wallet = requireWallet(); if (wallet) void perform('Vault redemption', () => redeemAll(config, wallet.provider, wallet.account, agent))
              }}>Redeem all</button>
            </div>
          </div>
        </section>

        <section className="drawer-section execution-panel">
          <div className="drawer-section-head"><span>how this task moves money</span><small>creator signs, policy enforces</small></div>
          <div className="execution-path"><span>idle {agent.vault.assetSymbol}</span><Icon name="arrow" /><span>{task?.production_route}</span><Icon name="arrow" /><span>vault share price</span></div>
          <ul className="execution-gates">{task?.safety_gates.map((gate) => <li key={gate.label}><strong>{gate.label}</strong><span>{gate.value}</span></li>)}</ul>
          <div className="execution-actions">
            <button type="button" className="run-cycle-button" disabled={Boolean(busy) || !isCreator || (!shouldRecenter && agent.vault.idleAssets === 0n)} onClick={() => {
              const wallet = requireWallet()
              if (!wallet || !task) return
              if (shouldRecenter) {
                void perform('Range recenter', () => recenterRange(config, wallet.provider, wallet.account, agent))
              } else {
                void perform(cycleLabel, () => runAgentCycle(config, wallet.provider, wallet.account, agent, task.target_allocation_bps))
              }
            }}><Icon name="spark" /> {cycleLabel}</button>
            <button type="button" className="recall-cycle-button" disabled={Boolean(busy) || !isCreator || agent.vault.deployedAssets === 0n} onClick={() => {
              const wallet = requireWallet(); if (wallet) void perform('Strategy recall', () => recallAgent(config, wallet.provider, wallet.account, agent))
            }}>Recall to vault</button>
          </div>
          {task && <p className="execution-state-note">{task.execution_note}</p>}
          <p className="honest-test-note">{routeNote} Contracts are tested but not independently audited.</p>
        </section>

        <section className="drawer-section key-overview-panel">
          <div className="drawer-section-head"><span>${agent.key.symbol} market</span><small>Key ≠ vault share</small></div>
          <div className="key-overview-primary">
            <div><small>floor</small><strong>{formatEthValue(agent.key.floorWei)}</strong></div>
            <div><small>top bid</small><strong>{formatEthValue(agent.key.topBidWei)}</strong></div>
            <div><small>listed</small><strong>{agent.key.listed.toString()}</strong></div>
            <div><small>market fee</small><strong>{feeBps / 100}%</strong></div>
          </div>
          <div className="key-overview-secondary">
            <span><small>supply</small><strong>{agent.key.supply.toString()}</strong></span>
            <span><small>bound</small><strong>{agent.key.totalBound.toString()}</strong></span>
            <span><small>your liquid</small><strong>{agent.key.walletBalance.toString()}</strong></span>
            <span><small>your bound</small><strong>{agent.key.walletBound.toString()}</strong></span>
          </div>
        </section>

        <section className="drawer-section key-market-panel live-key-action-panel">
          <div className="key-tabs">{(['buy', 'list', 'offer', 'sell', 'bind'] as const).map((item) => <button type="button" className={keyAction === item ? 'active' : ''} onClick={() => setKeyAction(item)} key={item}>{item}</button>)}</div>
          <div className="live-order-fields">
            <label><span>whole Keys</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" /></label>
            {(keyAction === 'list' || keyAction === 'offer') && <label><span>unit price</span><div><input value={keyPrice} onChange={(event) => setKeyPrice(event.target.value)} inputMode="decimal" /><b>ETH</b></div></label>}
          </div>
          <button type="button" className="key-action" disabled={Boolean(busy) || (keyAction === 'buy' && agent.key.floorWei === null) || (keyAction === 'sell' && agent.key.topBidWei === null)} onClick={() => void executeKeyAction()}>{busy || `${keyAction} ${quantity || '0'} ${agent.key.symbol}`}</button>
          <div className="fee-note"><Icon name="key" /><span>Keys control access and market demand. {agent.vault.symbol} shares own the vault claim.</span></div>
        </section>

        {(notice || actionError) && <div className={`transaction-notice ${actionError ? 'error' : ''}`} role="status">{actionError || notice}</div>}
      </aside>
    </div>
  )
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
