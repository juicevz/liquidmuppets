import { useEffect, useMemo, useState } from 'react'
import type { Address } from 'viem'
import { Icon } from '../components/Icon'
import { pets } from '../data/pets'
import { defaultMarketForTask, marketsForTask } from '../data/strategyMarkets'
import { useProtocol } from '../hooks/useProtocol'
import { fetchTokenAccess, type TokenAccess } from '../lib/api'
import { getInjectedProvider, launchAgent, type LaunchResult } from '../lib/protocol'
import { actionErrorMessage } from '../lib/errors'
import type { StrategyTaskId } from '../types'

interface CreateAgentPageProps {
  creatorHandle: string
  walletAddress?: string
  onConnect: () => void
}

const steps = ['Pet', 'Task', 'Market', 'Key', 'Launch'] as const

const taskDetails: Record<StrategyTaskId, { summary: string; movement: string; guardrail: string }> = {
  0: {
    summary: 'Routes idle USDG into one fixed Morpho Blue market while the vault keeps a cash reserve.',
    movement: 'A cycle can allocate up to the 90% target after the market, utilization, oracle, and vault-cap checks pass.',
    guardrail: 'Depositors keep ERC-4626 vault shares. Yield is variable and withdrawals depend on available market liquidity.',
  },
  1: {
    summary: 'Converts WETH through the canonical WETH and USDG pool, then opens a separately-accounted EZManager range.',
    movement: 'The first cycle deploys 85%. After the daily movement limit resets, the creator can atomically close and recenter it.',
    guardrail: '15% stays idle, each vault is capped at 1 WETH, and EZManager currently charges a 0.4% entry fee.',
  },
  2: {
    summary: 'Keeps a small, isolated WETH reserve ready for a reviewed launch-liquidity route.',
    movement: 'A cycle can stage 10% in the reserve. No token pool is active, so the reserve does not trade or earn fees yet.',
    guardrail: '90% stays idle, each vault is capped at 0.25 WETH, and staged WETH remains recallable at any time.',
  },
}

export function CreateAgentPage({ creatorHandle, walletAddress, onConnect }: CreateAgentPageProps) {
  const { config, tasks, loading, error, refresh } = useProtocol(walletAddress)
  const [step, setStep] = useState(0)
  const [petId, setPetId] = useState(0)
  const [taskId, setTaskId] = useState<StrategyTaskId>(0)
  const [marketId, setMarketId] = useState(defaultMarketForTask(0).id)
  const [name, setName] = useState('')
  const [keySymbol, setKeySymbol] = useState('')
  const [keySupply, setKeySupply] = useState('100')
  const [listingQuantity, setListingQuantity] = useState('20')
  const [floorPrice, setFloorPrice] = useState('0.01')
  const [progress, setProgress] = useState('')
  const [launchError, setLaunchError] = useState('')
  const [result, setResult] = useState<LaunchResult | null>(null)
  const [access, setAccess] = useState<TokenAccess | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)

  const pet = pets[petId]
  const task = tasks.find((item) => item.id === taskId)
  const marketOptions = marketsForTask(taskId)
  const market = marketOptions.find((item) => item.id === marketId) ?? defaultMarketForTask(taskId)
  const supply = Number(keySupply)
  const listed = Number(listingQuantity)
  const floor = Number(floorPrice)
  const keyValid = /^[A-Za-z0-9]{2,10}$/.test(keySymbol)
  const formReady = Boolean(
    name.trim().length >= 2 && name.trim().length <= 32 && keyValid
      && Number.isInteger(supply) && supply >= 10 && supply <= 100_000
      && Number.isInteger(listed) && listed >= 1 && listed <= supply
      && Number.isFinite(floor) && floor > 0,
  )
  const routeCanLaunch = Boolean(
    config?.factory && config.keyMarketplace && formReady && Boolean(task?.live) && market?.status === 'live',
  )
  const canLaunch = routeCanLaunch && (!walletAddress || access?.eligible === true)
  const canContinue = useMemo(
    () => step === 0
      || (step === 1 && Boolean(task))
      || (step === 2 && market?.status === 'live')
      || (step === 3 && formReady),
    [formReady, market?.status, step, task],
  )
  const detail = task ? taskDetails[task.id] : null
  const route = task
    ? config?.mode === 'testnet' ? task.testnet_route : task.production_route
    : ''

  useEffect(() => {
    if (!walletAddress) {
      setAccess(null)
      setAccessLoading(false)
      return
    }
    let active = true
    setAccessLoading(true)
    fetchTokenAccess(walletAddress)
      .then((next) => {
        if (active) setAccess(next)
      })
      .catch(() => {
        if (active) setAccess(null)
      })
      .finally(() => {
        if (active) setAccessLoading(false)
      })
    return () => { active = false }
  }, [walletAddress])

  const selectTask = (nextTaskId: StrategyTaskId) => {
    setTaskId(nextTaskId)
    setMarketId(defaultMarketForTask(nextTaskId).id)
  }

  const deploy = async () => {
    if (!walletAddress) {
      onConnect()
      return
    }
    if (!config || !canLaunch) return
    const provider = getInjectedProvider()
    if (!provider) {
      setLaunchError('No injected wallet was found.')
      return
    }
    setLaunchError('')
    setResult(null)
    try {
      setProgress('Checking $MUPPETS access…')
      const latestAccess = await fetchTokenAccess(walletAddress)
      setAccess(latestAccess)
      if (!latestAccess.eligible) {
        const required = Number(latestAccess.minimum).toLocaleString('en-US')
        throw new Error(latestAccess.reason === 'token_not_configured'
          ? 'The canonical $MUPPETS contract is not configured yet.'
          : `Hold at least ${required} $MUPPETS to launch a Muppet.`)
      }
      const next = await launchAgent(config, provider, walletAddress as Address, {
        petId,
        taskId,
        name: name.trim(),
        keySymbol: keySymbol.trim(),
        keySupply: supply,
        listingQuantity: listed,
        floorPriceEth: floorPrice,
      }, setProgress)
      setResult(next)
      setProgress('Muppet launched. Vault, Key, and first ask are live.')
      refresh()
    } catch (reason) {
      setLaunchError(actionErrorMessage(reason, 'The launch failed.'))
      setProgress('')
    }
  }

  return (
    <div className="app-page create-page live-builder-page">
      <section className="app-page-heading create-heading">
        <div>
          <h1>Pick the pet. Pick the work.</h1>
          <p>The appearance is cosmetic. The task fixes the vault; the market step shows its live route and the routes still under review.</p>
        </div>
        <div className={`protocol-ready-card ${config?.factory ? 'ready' : ''}`}>
          <small>launch status</small>
          <strong>{loading ? 'checking' : config?.factory ? 'ready' : 'not deployed'}</strong>
        </div>
      </section>

      {(error || launchError) && <div className="protocol-error" role="alert"><Icon name="alert" />{launchError || error}</div>}

      <section className="builder-shell live-builder-shell">
        <aside className="builder-sidebar">
          <div className="builder-progress compact-builder-progress">
            {steps.map((label, index) => (
              <button type="button" key={label} className={`${step === index ? 'active' : ''}${step > index ? ' complete' : ''}`} onClick={() => setStep(index)}>
                <span>{step > index ? <Icon name="check" /> : index + 1}</span><strong>{label}</strong>
              </button>
            ))}
          </div>
          <div className="builder-safety-note">
            <Icon name="shield" />
            <strong>Your wallet deploys it.</strong>
            <p>Three confirmations create the agent, approve the initial Keys, and open the first ask.</p>
          </div>
        </aside>

        <div className="builder-content">
          {step === 0 && (
            <div className="builder-step">
              <span className="builder-step-number">01 / APPEARANCE</span>
              <h2>Choose one of seven pets.</h2>
              <div className="pet-picker" role="group" aria-label="Choose pet appearance">
                {pets.map((item) => (
                  <button type="button" className={petId === item.id ? 'active' : ''} onClick={() => setPetId(item.id)} key={item.id}>
                    <img src={item.portrait} alt={`${item.name} pet`} /><span>{item.name}</span><i />
                  </button>
                ))}
              </div>
              <div className="cosmetic-note"><Icon name="check" /> Appearance changes no permissions, yield, Key supply, or vault ownership.</div>
            </div>
          )}

          {step === 1 && (
            <div className="builder-step">
              <span className="builder-step-number">02 / TYPE OF TASK</span>
              <h2>What should this pet do?</h2>
              <div className="task-picker" role="group" aria-label="Choose type of task">
                {tasks.map((item) => (
                  <button type="button" aria-pressed={taskId === item.id} className={taskId === item.id ? 'active' : ''} onClick={() => selectTask(item.id)} key={item.id}>
                    <span className={`task-availability ${item.live ? 'live' : ''}`}>{item.execution_mode === 'reserve' ? 'reserve live' : item.live ? 'available' : 'preview'}</span>
                    <strong>{item.label}</strong><span className="task-assets">{item.deposit_asset} → {item.share_prefix}</span><i />
                  </button>
                ))}
              </div>
              {task && (
                <div className="task-explainer" aria-live="polite">
                  <div className="task-money-path">
                    <span><small>deposit</small><strong>{task.deposit_asset}</strong></span>
                    <Icon name="arrow" />
                    <span><small>vault receipt</small><strong>{task.share_prefix}-KEY</strong></span>
                    <Icon name="arrow" />
                    <span><small>route</small><strong>{route}</strong></span>
                  </div>
                  {detail && (
                    <div className="task-detail-grid">
                      <div><small>what it does</small><p>{detail.summary}</p></div>
                      <div><small>when it moves</small><p>{detail.movement}</p></div>
                      <div><small>limits</small><p>{detail.guardrail}</p></div>
                    </div>
                  )}
                  <p className={`task-execution-note task-${task.execution_mode}`}>{task.execution_note}</p>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="builder-step market-universe-step">
              <span className="builder-step-number">03 / MARKET</span>
              <h2>Choose where this pet can work.</h2>
              <div className="market-status-legend" aria-label="Market route status">
                <span><i className="live" /> live now</span>
                <span><i /> route review</span>
              </div>
              <div className="strategy-market-grid" role="group" aria-label="Choose market route">
                {marketOptions.map((item) => (
                  <button
                    type="button"
                    className={`${market?.id === item.id ? 'active' : ''} market-${item.status}`}
                    aria-pressed={market?.id === item.id}
                    onClick={() => setMarketId(item.id)}
                    key={item.id}
                  >
                    <span className="strategy-market-topline"><small>{item.groupLabel}</small><b>{item.status === 'live' ? 'live' : 'route review'}</b></span>
                    <strong>{item.title}</strong>
                    <span className="strategy-market-pair">{item.market}</span>
                    <p>{item.description}</p>
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
              {market && (
                <div className={`strategy-market-detail market-detail-${market.status}`} aria-live="polite">
                  <div>
                    <span><small>selected market</small><strong>{market.market}</strong></span>
                    <b>{market.status === 'live' ? 'ready in current factory' : 'requires a new reviewed adapter'}</b>
                  </div>
                  <ul>{market.checks.map((check) => <li key={check}><Icon name="check" />{check}</li>)}</ul>
                  {market.status === 'review' && (
                    <p className="market-review-boundary"><Icon name="lock" /><span><strong>Visible for route review.</strong> The current factory cannot deploy this market yet. Choose the live route to launch today.</span></p>
                  )}
                  {market.usesStockTokens && <p className="stock-token-note">Stock Tokens provide tokenized exposure. They are not shares in the underlying company, and availability can depend on jurisdiction.</p>}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="builder-step">
              <span className="builder-step-number">04 / KEY MARKET</span>
              <h2>Name it and open the floor.</h2>
              <div className="form-grid key-launch-form">
                <label><span>muppet name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} placeholder="quiet fox" /></label>
                <label><span>creator</span><input value={creatorHandle} readOnly /></label>
                <label><span>Key ticker</span><input value={keySymbol} onChange={(event) => setKeySymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="QFOX" /></label>
                <label><span>Key supply</span><input value={keySupply} onChange={(event) => setKeySupply(event.target.value)} inputMode="numeric" /></label>
                <label><span>initial Keys listed</span><input value={listingQuantity} onChange={(event) => setListingQuantity(event.target.value)} inputMode="numeric" /></label>
                <label><span>base floor</span><div className="unit-input"><input value={floorPrice} onChange={(event) => setFloorPrice(event.target.value)} inputMode="decimal" /><b>ETH</b></div></label>
              </div>
              <div className="floor-explainer"><Icon name="key" /><span><strong>This becomes a real ask.</strong> The floor is the cheapest active listing, so it can move when listings sell or someone lists lower.</span></div>
            </div>
          )}

          {step === 4 && (
            <div className="builder-step review-step">
              <span className="builder-step-number">05 / LAUNCH</span>
              <h2>Three confirmations, one Muppet.</h2>
              <div className="live-launch-review">
                <div className="review-pet"><img src={pet.portrait} alt="" /><span><small>appearance</small><strong>{pet.name}</strong></span></div>
                <div><small>task</small><strong>{task?.label ?? 'loading'}</strong></div>
                <div className="review-market"><small>market</small><strong>{market?.market ?? 'loading'}</strong></div>
                <div><small>vault share</small><strong>{task?.share_prefix}-{keySymbol || 'KEY'}</strong></div>
                <div><small>Agent Key</small><strong>{supply || 0} ${keySymbol || 'KEY'}</strong></div>
                <div><small>first ask</small><strong>{listed || 0} at {floorPrice || '0'} ETH</strong></div>
                <div><small>market fee</small><strong>3% per fill</strong></div>
              </div>
              <div className="deployment-sequence">
                <span><b>1</b> deploy vault + Key</span><span><b>2</b> approve listed Keys</span><span><b>3</b> open first ask</span>
              </div>
              <div className={`launch-token-gate ${access?.eligible ? 'unlocked' : 'locked'}`}>
                <Icon name={access?.eligible ? 'check' : 'lock'} />
                <span>
                  <strong>100,000 $MUPPETS required to launch.</strong>
                  <small>{!walletAddress
                    ? 'Connect a wallet to check its Robinhood Chain balance.'
                    : accessLoading
                      ? 'Checking the connected wallet.'
                      : access?.eligible
                        ? `${access.balance} $MUPPETS verified. Launch is unlocked.`
                        : access?.reason === 'below_minimum'
                          ? `Wallet balance: ${access.balance ?? '0'} $MUPPETS. Tokens remain in the wallet.`
                          : 'Launch stays locked until the canonical $MUPPETS contract is configured and readable.'}</small>
                </span>
              </div>
              {task && !task.live && <div className="route-unavailable"><Icon name="lock" /><span><strong>Preview is ready.</strong> Launch unlocks when this route adapter is deployed.</span></div>}
              <button type="button" className="builder-primary" disabled={!canLaunch || Boolean(progress && !result)} onClick={deploy}>
                <Icon name={task?.live && !walletAddress ? 'wallet' : access?.eligible ? 'receipt' : 'lock'} /> {task && !task.live
                  ? 'Route not live yet'
                  : !walletAddress
                    ? 'Connect wallet'
                    : accessLoading
                      ? 'Checking $MUPPETS'
                      : access?.eligible
                        ? 'Launch Muppet'
                        : access?.reason === 'below_minimum'
                          ? 'Hold 100,000 $MUPPETS'
                          : '$MUPPETS contract pending'}
              </button>
              {progress && <div className={`transaction-progress ${result ? 'complete' : ''}`} role="status"><Icon name={result ? 'check' : 'spark'} />{progress}</div>}
              {result && config && (
                <div className="launch-receipts">
                  <a href={`${config.explorerUrl}/tx/${result.createTx}`} target="_blank" rel="noreferrer">vault + Key tx <Icon name="arrow" /></a>
                  <a href={`${config.explorerUrl}/tx/${result.listingTx}`} target="_blank" rel="noreferrer">floor listing tx <Icon name="arrow" /></a>
                </div>
              )}
            </div>
          )}

          <div className="builder-footer">
            <button type="button" className="builder-back" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
            {step < steps.length - 1 && <button type="button" className="builder-next" disabled={!canContinue} onClick={() => setStep(step + 1)}>Continue <Icon name="arrow" /></button>}
          </div>
        </div>

        <aside className="builder-preview live-pet-preview">
          <span className="preview-label">YOUR MUPPET</span>
          <div className="preview-card">
            <div className="preview-portrait"><img src={pet.portrait} alt="" /></div>
            <h3>{name || pet.name}</h3>
            <p>{creatorHandle}</p>
            <span className="preview-category">{market?.title ?? task?.label ?? 'choose market'}</span>
            <div className="preview-line" />
            <div className="preview-stats"><span><small>Key floor</small><strong>{floorPrice || '0'} ETH</strong></span><span><small>vault</small><strong>{task?.share_prefix ?? 'mAsset'}</strong></span></div>
          </div>
          <p className="preview-footnote">The pet is cosmetic. Only a live market can launch.</p>
        </aside>
      </section>
    </div>
  )
}
