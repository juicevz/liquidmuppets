import { useEffect, useMemo, useState } from 'react'
import { parseUnits, type Address, type Hash } from 'viem'
import { Icon } from '../components/Icon'
import { pets } from '../data/pets'
import { defaultMarketForTask, marketsForTask } from '../data/strategyMarkets'
import { useProtocol } from '../hooks/useProtocol'
import { fetchMuppetPerformance, fetchTokenAccess, type MuppetPerformance, type ProtocolConfig, type TokenAccess } from '../lib/api'
import {
  clearLaunchSession,
  createLaunchSession,
  launchHasStarted,
  launchResultFromCheckpoint,
  readLaunchSession,
  saveLaunchSession,
  withLaunchCheckpoint,
  type LaunchSession,
} from '../lib/launchSession'
import { performancePath } from '../lib/navigation'
import {
  depositToVault,
  formatAsset,
  getInjectedProvider,
  launchAgent,
  loadVaultFundingTarget,
  previewVaultDeposit,
  type ChainAgent,
  type LaunchCheckpoint,
  type LaunchInput,
  type LaunchResult,
  type VaultFundingTarget,
} from '../lib/protocol'
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
    summary: 'Keeps a small WETH position inside the vault\'s isolated launch-reserve adapter.',
    movement: 'A cycle can stage 10% in the reserve. The position stays in WETH and remains recallable.',
    guardrail: '90% stays idle, each vault is capped at 0.25 WETH, and staged WETH remains recallable at any time.',
  },
}

export function CreateAgentPage({ creatorHandle, walletAddress, onConnect }: CreateAgentPageProps) {
  const { config, snapshot, tasks, loading, error, refresh } = useProtocol(walletAddress)
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
  const [launching, setLaunching] = useState(false)
  const [session, setSession] = useState<LaunchSession | null>(null)
  const [access, setAccess] = useState<TokenAccess | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)

  const pet = pets[petId]
  const task = tasks.find((item) => item.id === taskId)
  const marketOptions = marketsForTask(taskId)
  const market = marketOptions.find((item) => item.id === marketId) ?? defaultMarketForTask(taskId)
  const supply = Number(keySupply)
  const listed = Number(listingQuantity)
  const floor = Number(floorPrice)
  const requiredMuppets = Number(access?.minimum ?? config?.accessGate.minimum ?? 15_000).toLocaleString('en-US')
  const keyValid = /^[A-Za-z0-9]{2,10}$/.test(keySymbol)
  const formReady = Boolean(
    name.trim().length >= 2 && name.trim().length <= 32 && keyValid
      && Number.isInteger(supply) && supply >= 10 && supply <= 100_000
      && Number.isInteger(listed) && listed >= 1 && listed <= supply
      && Number.isFinite(floor) && floor > 0,
  )
  const routeCanLaunch = Boolean(
    config?.factory && config.keyMarketplace && formReady && Boolean(task?.live) && market,
  )
  const recoveryReady = Boolean(config?.factory && config.keyMarketplace && formReady)
  const canLaunch = routeCanLaunch && (!walletAddress || access?.eligible === true)
  const checkpoint = session?.checkpoint ?? {}
  const result = launchResultFromCheckpoint(checkpoint)
  const launchStarted = launchHasStarted(checkpoint)
  const commandAgent = result ? snapshot?.agents.find((agent) => agent.id === result.agentId) : undefined
  const canContinue = useMemo(
    () => step === 0
      || (step === 1 && Boolean(task))
      || (step === 2 && Boolean(market))
      || (step === 3 && formReady),
    [formReady, market?.id, step, task],
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

  useEffect(() => {
    if (!config?.factory || !walletAddress) {
      setSession(null)
      return
    }
    const stored = readLaunchSession(window.localStorage, config.chainId, config.factory, walletAddress as Address)
    setSession(stored)
    if (!stored) return
    setPetId(stored.input.petId)
    setTaskId(stored.input.taskId)
    setMarketId(defaultMarketForTask(stored.input.taskId).id)
    setName(stored.input.name)
    setKeySymbol(stored.input.keySymbol)
    setKeySupply(String(stored.input.keySupply))
    setListingQuantity(String(stored.input.listingQuantity))
    setFloorPrice(stored.input.floorPriceEth)
    setStep(4)
    setProgress(launchResultFromCheckpoint(stored.checkpoint)
      ? 'Muppet launched. Vault, Key, and first ask are live.'
      : 'Recovered an unfinished launch. Continue from the first unconfirmed transaction.')
  }, [config?.chainId, config?.factory, walletAddress])

  useEffect(() => {
    if (!result || commandAgent) return
    refresh()
  }, [commandAgent, refresh, result?.agentId])

  const selectTask = (nextTaskId: StrategyTaskId) => {
    setTaskId(nextTaskId)
    setMarketId(defaultMarketForTask(nextTaskId).id)
  }

  const deploy = async () => {
    if (!walletAddress) {
      onConnect()
      return
    }
    if (!config?.factory || (!launchStarted && !canLaunch) || (launchStarted && !recoveryReady)) return
    const provider = getInjectedProvider()
    if (!provider) {
      setLaunchError('No injected wallet was found.')
      return
    }
    setLaunchError('')
    setLaunching(true)
    const input: LaunchInput = session?.input ?? {
      petId,
      taskId,
      name: name.trim(),
      keySymbol: keySymbol.trim(),
      keySupply: supply,
      listingQuantity: listed,
      floorPriceEth: floorPrice,
    }
    let activeSession = session ?? createLaunchSession(
      config.chainId,
      config.factory,
      walletAddress as Address,
      input,
    )
    try {
      if (!launchHasStarted(activeSession.checkpoint)) {
        setProgress('Checking $MUPPETS access…')
        const latestAccess = await fetchTokenAccess(walletAddress)
        setAccess(latestAccess)
        if (!latestAccess.eligible) {
          const required = Number(latestAccess.minimum).toLocaleString('en-US')
          throw new Error(latestAccess.reason === 'token_not_configured'
            ? 'The canonical $MUPPETS contract address is required to launch.'
            : `Hold at least ${required} $MUPPETS to launch a Muppet.`)
        }
      }
      await launchAgent(config, provider, walletAddress as Address, input, {
        checkpoint: activeSession.checkpoint,
        onProgress: setProgress,
        onCheckpoint: (nextCheckpoint) => {
          activeSession = withLaunchCheckpoint(activeSession, nextCheckpoint)
          saveLaunchSession(window.localStorage, activeSession)
          setSession(activeSession)
        },
      })
      setProgress('Muppet launched. Vault, Key, and first ask are live.')
      refresh()
    } catch (reason) {
      setLaunchError(actionErrorMessage(reason, 'The launch failed.'))
      setProgress(launchHasStarted(activeSession.checkpoint)
        ? 'Launch paused. The submitted receipts are saved in this browser.'
        : '')
    } finally {
      setLaunching(false)
    }
  }

  const resetLaunch = () => {
    if (config?.factory && walletAddress) {
      clearLaunchSession(window.localStorage, config.chainId, config.factory, walletAddress as Address)
    }
    setSession(null)
    setStep(0)
    setPetId(0)
    setTaskId(0)
    setMarketId(defaultMarketForTask(0).id)
    setName('')
    setKeySymbol('')
    setKeySupply('100')
    setListingQuantity('20')
    setFloorPrice('0.01')
    setProgress('')
    setLaunchError('')
  }

  return (
    <div className="app-page create-page live-builder-page">
      <section className="app-page-heading create-heading">
        <div>
          <h1>{result ? 'Launch complete.' : 'Pick the pet. Pick the work.'}</h1>
          <p>{result
            ? 'The Muppet is live. Fund its vault, watch the keeper, and share the public record.'
            : 'The appearance is cosmetic. The task fixes the vault and its deployed money route.'}</p>
        </div>
      </section>

      {(error || launchError) && <div className="protocol-error" role="alert"><Icon name="alert" />{launchError || error}</div>}

      <section className="builder-shell live-builder-shell">
        <aside className="builder-sidebar">
          <div className="builder-progress compact-builder-progress">
            {steps.map((label, index) => (
              <button type="button" key={label} disabled={launchStarted} className={`${step === index ? 'active' : ''}${step > index || (Boolean(result) && index === 4) ? ' complete' : ''}`} onClick={() => setStep(index)}>
                <span>{step > index || (result && index === 4) ? <Icon name="check" /> : index + 1}</span><strong>{label}</strong>
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
              <div className="strategy-market-grid" role="group" aria-label="Choose market route">
                {marketOptions.map((item) => (
                  <button
                    type="button"
                    className={market?.id === item.id ? 'active' : ''}
                    aria-pressed={market?.id === item.id}
                    onClick={() => setMarketId(item.id)}
                    key={item.id}
                  >
                    <span className="strategy-market-topline"><small>{item.groupLabel}</small></span>
                    <strong>{item.title}</strong>
                    <span className="strategy-market-pair">{item.market}</span>
                    <p>{item.description}</p>
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
              {market && (
                <div className="strategy-market-detail" aria-live="polite">
                  <div>
                    <span><small>selected market</small><strong>{market.market}</strong></span>
                  </div>
                  <ul>{market.checks.map((check) => <li key={check}><Icon name="check" />{check}</li>)}</ul>
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
              {result && config ? (
                <LaunchCommandCenter
                  agent={commandAgent}
                  chainLoading={loading}
                  config={config}
                  input={session!.input}
                  result={result}
                  sessionUpdatedAt={session!.updatedAt}
                  wallet={walletAddress as Address}
                  onRefresh={refresh}
                  onReset={resetLaunch}
                />
              ) : (
                <>
                  <h2>{launchStarted ? 'Finish this launch.' : 'Three confirmations, one Muppet.'}</h2>
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
                  <div className={`launch-token-gate ${access?.eligible || launchStarted ? 'unlocked' : 'locked'}`}>
                    <Icon name={access?.eligible || launchStarted ? 'check' : 'lock'} />
                    <span>
                      <strong>{launchStarted ? 'Launch recovery ready.' : `${requiredMuppets} $MUPPETS required to launch.`}</strong>
                      <small>{launchStarted
                        ? 'This browser saved each submitted receipt. Resume continues at the first unfinished confirmation.'
                        : !walletAddress
                          ? 'Connect a wallet to check its Robinhood Chain balance.'
                          : accessLoading
                            ? 'Checking the connected wallet.'
                            : access?.eligible
                              ? `${access.balance} $MUPPETS verified. Launch is unlocked.`
                              : access?.reason === 'below_minimum'
                                ? `Wallet balance: ${access.balance ?? '0'} $MUPPETS. Tokens remain in the wallet.`
                                : 'Add the canonical $MUPPETS contract address to enable launch.'}</small>
                      {config?.accessGate.tokenAddress && (
                        <a
                          className="launch-token-address"
                          href={`${config.explorerUrl}/address/${config.accessGate.tokenAddress}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`MUPPETS contract ${config.accessGate.tokenAddress}`}
                        >CA {config.accessGate.tokenAddress}</a>
                      )}
                    </span>
                  </div>
                  <button type="button" className="builder-primary" disabled={launching || (launchStarted ? !recoveryReady : !canLaunch)} onClick={deploy}>
                    <Icon name={launchStarted ? 'receipt' : task?.live && !walletAddress ? 'wallet' : access?.eligible ? 'receipt' : 'lock'} /> {launching
                      ? 'Waiting for wallet'
                      : launchStarted
                        ? 'Resume launch'
                        : task && !task.live
                          ? 'Route unavailable'
                          : !walletAddress
                            ? 'Connect wallet'
                            : accessLoading
                              ? 'Checking $MUPPETS'
                              : access?.eligible
                                ? 'Launch Muppet'
                                : access?.reason === 'below_minimum'
                                  ? `Hold ${requiredMuppets} $MUPPETS`
                                  : '$MUPPETS address required'}
                  </button>
                  {progress && <div className="transaction-progress" role="status"><Icon name="spark" />{progress}</div>}
                  {session && config && <LaunchReceiptTracker checkpoint={session.checkpoint} explorerUrl={config.explorerUrl} />}
                </>
              )}
            </div>
          )}

          <div className="builder-footer">
            <button type="button" className="builder-back" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || launchStarted}>Back</button>
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
        </aside>
      </section>
    </div>
  )
}

function LaunchReceiptTracker({ checkpoint, explorerUrl }: { checkpoint: LaunchCheckpoint; explorerUrl: string }) {
  const stages = [
    { label: 'vault + Key', hash: checkpoint.createTx, confirmed: checkpoint.createConfirmed },
    { label: 'Key approval', hash: checkpoint.approveTx, confirmed: checkpoint.approveConfirmed },
    { label: 'first ask', hash: checkpoint.listingTx, confirmed: checkpoint.listingConfirmed },
  ]
  return (
    <div className="launch-stage-list" aria-label="Launch transaction receipts">
      {stages.map((stage, index) => (
        <div className={`launch-stage ${stage.confirmed ? 'confirmed' : stage.hash ? 'submitted' : 'waiting'}`} key={stage.label}>
          <span><b>{stage.confirmed ? <Icon name="check" /> : index + 1}</b><strong>{stage.label}</strong></span>
          {stage.hash ? (
            <a href={`${explorerUrl}/tx/${stage.hash}`} target="_blank" rel="noreferrer" title={stage.hash}>
              {stage.confirmed ? 'confirmed' : 'submitted'} · {shortHash(stage.hash)} <Icon name="arrow" />
            </a>
          ) : <small>waiting</small>}
        </div>
      ))}
    </div>
  )
}

interface LaunchCommandCenterProps {
  agent?: ChainAgent
  chainLoading: boolean
  config: ProtocolConfig
  input: LaunchInput
  result: LaunchResult
  sessionUpdatedAt: string
  wallet: Address
  onRefresh: () => void
  onReset: () => void
}

function LaunchCommandCenter({
  agent,
  chainLoading,
  config,
  input,
  result,
  sessionUpdatedAt,
  wallet,
  onRefresh,
  onReset,
}: LaunchCommandCenterProps) {
  const [fundAmount, setFundAmount] = useState(input.taskId === 0 ? '100' : '0.1')
  const [previewShares, setPreviewShares] = useState<bigint | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [fundProgress, setFundProgress] = useState('')
  const [fundError, setFundError] = useState('')
  const [fundReceipts, setFundReceipts] = useState<Hash[]>([])
  const [funding, setFunding] = useState(false)
  const [directTarget, setDirectTarget] = useState<VaultFundingTarget | null>(null)
  const [targetLoading, setTargetLoading] = useState(false)
  const [performance, setPerformance] = useState<MuppetPerformance | null>(null)
  const [now, setNow] = useState(Date.now())

  const performanceHref = performancePath(result.agentId)
  const performanceUrl = typeof window === 'undefined'
    ? `https://liquidmuppets.io${performanceHref}`
    : new URL(performanceHref, window.location.origin).href
  const taskLabel = input.taskId === 0 ? 'stable yield' : input.taskId === 1 ? 'ETH range' : 'launch reserve'
  const shareText = `${input.name} is live on @liquidmuppets.\n\n${taskLabel}, an onchain vault, and public performance from the first recorded checkpoint.`
  const shareHref = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(performanceUrl)}`
  const fundingTarget: VaultFundingTarget | null = agent ?? directTarget
  const amountRaw = useMemo(() => {
    if (!fundingTarget) return null
    try {
      const value = parseUnits(fundAmount, fundingTarget.vault.assetDecimals)
      return value > 0n ? value : null
    } catch {
      return null
    }
  }, [fundAmount, fundingTarget])
  const amountAvailable = Boolean(fundingTarget && amountRaw !== null && amountRaw <= fundingTarget.vault.walletAssetBalance)

  useEffect(() => {
    if (agent) {
      setDirectTarget(null)
      setTargetLoading(false)
      return
    }
    let active = true
    setTargetLoading(true)
    const load = () => loadVaultFundingTarget(config, result.vault, wallet)
      .then((next) => {
        if (!active) return
        setDirectTarget(next)
        setTargetLoading(false)
      })
      .catch(() => { if (active) setTargetLoading(false) })
    void load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agent, config, result.vault, wallet])

  useEffect(() => {
    let active = true
    const load = () => fetchMuppetPerformance(Number(result.agentId))
      .then((next) => { if (active) setPerformance(next) })
      .catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [result.agentId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setPreviewShares(null)
    setPreviewError('')
    if (!fundingTarget || !amountRaw) return
    let active = true
    const timer = window.setTimeout(() => {
      previewVaultDeposit(config, fundingTarget, fundAmount)
        .then((shares) => { if (active) setPreviewShares(shares) })
        .catch(() => { if (active) setPreviewError('Preview unavailable') })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [amountRaw, config, fundAmount, fundingTarget])

  const fundVault = async () => {
    if (!fundingTarget || !amountAvailable) return
    const provider = getInjectedProvider()
    if (!provider) {
      setFundError('No injected wallet was found.')
      return
    }
    setFunding(true)
    setFundError('')
    setFundReceipts([])
    try {
      const receipts = await depositToVault(config, provider, wallet, fundingTarget, fundAmount, setFundProgress)
      setFundReceipts(receipts)
      setFundProgress('Vault funded. Your ERC-4626 shares are in the connected wallet.')
      onRefresh()
    } catch (reason) {
      setFundError(actionErrorMessage(reason, 'The vault deposit failed.'))
      setFundProgress('')
    } finally {
      setFunding(false)
    }
  }

  return (
    <div className="launch-command-center">
      <div className="command-center-heading">
        <div>
          <span>LAUNCH COMPLETE · MUPPET #{result.agentId.toString()}</span>
          <h2>Muppet live. Put it to work.</h2>
          <p>Fund the vault, watch the keeper, open the public record, or share it from here.</p>
        </div>
        <span className="command-center-live"><i /> live</span>
      </div>

      <LaunchReceiptTracker checkpoint={{
        createTx: result.createTx,
        createConfirmed: true,
        agentId: result.agentId,
        vault: result.vault,
        key: result.key,
        approveTx: result.approveTx,
        approveConfirmed: true,
        listingTx: result.listingTx,
        listingConfirmed: true,
      }} explorerUrl={config.explorerUrl} />

      <div className="command-center-grid">
        <section className="command-card funding-card">
          <div className="command-card-head"><Icon name="wallet" /><span><small>01</small><h3>Fund vault</h3></span></div>
          <p>Previewed by the deployed ERC-4626 vault before your wallet signs.</p>
          {fundingTarget ? (
            <>
              <label className="command-fund-input">
                <span>deposit amount</span>
                <div className="unit-input"><input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" /><b>{fundingTarget.vault.assetSymbol}</b></div>
              </label>
              <div className="command-fund-preview">
                <span><small>expected vault shares</small><strong>{previewShares !== null ? `${formatAsset(previewShares, fundingTarget.vault.shareDecimals, 6)} ${fundingTarget.vault.symbol}` : previewError || 'reading onchain'}</strong></span>
                <span><small>wallet balance</small><strong>{formatAsset(fundingTarget.vault.walletAssetBalance, fundingTarget.vault.assetDecimals, 6)} {fundingTarget.vault.assetSymbol}</strong></span>
              </div>
              {amountRaw !== null && amountRaw > fundingTarget.vault.walletAssetBalance && <small className="command-warning">Amount exceeds this wallet balance.</small>}
              <button type="button" className="command-primary" disabled={funding || !amountAvailable || previewShares === null} onClick={fundVault}>
                <Icon name="wallet" /> {funding ? 'Waiting for wallet' : 'Fund vault now'}
              </button>
            </>
          ) : (
            <div className="command-loading">
              <Icon name="spark" />
              <span><strong>{chainLoading || targetLoading ? 'Reading the new vault…' : 'Vault state is catching up.'}</strong><small>No transaction is needed to refresh it.</small></span>
              <button type="button" onClick={onRefresh}>Refresh</button>
            </div>
          )}
          {fundProgress && <div className="transaction-notice" role="status"><Icon name="check" />{fundProgress}</div>}
          {fundError && <div className="transaction-notice error" role="alert"><Icon name="alert" />{fundError}</div>}
          {fundReceipts.length > 0 && (
            <div className="launch-receipts">
              <a href={`${config.explorerUrl}/tx/${fundReceipts[0]}`} target="_blank" rel="noreferrer">asset approval <Icon name="arrow" /></a>
              <a href={`${config.explorerUrl}/tx/${fundReceipts[1]}`} target="_blank" rel="noreferrer">vault deposit <Icon name="arrow" /></a>
            </div>
          )}
        </section>

        <section className="command-card keeper-card">
          <div className="command-card-head"><Icon name="clock" /><span><small>02</small><h3>Next keeper check</h3></span></div>
          <div className="keeper-next-time">
            <small>next automatic check</small>
            <strong>{keeperTiming(performance, now)}</strong>
          </div>
          {performance?.keeper ? (
            <div className="keeper-last-decision">
              <span><small>last decision</small><strong>{performance.keeper.action}</strong></span>
              <p>{performance.keeper.reason}</p>
            </div>
          ) : <p className="keeper-awaiting">Waiting for the first recorded decision.</p>}
          <p className="command-boundary">The five minute schedule is automatic. Policy still decides whether the keeper acts or holds.</p>
        </section>

        <section className="command-card public-card">
          <div className="command-card-head"><Icon name="receipt" /><span><small>03</small><h3>Public record</h3></span></div>
          <p>Performance starts with the first recorded checkpoint. No earlier APY or history is invented.</p>
          <div className="command-public-links">
            <a className="command-primary" href={performanceHref}><Icon name="layers" /> Open performance</a>
            <a className="command-secondary" href={shareHref} target="_blank" rel="noreferrer"><Icon name="arrow" /> Share on X</a>
          </div>
          <div className="command-addresses">
            <a href={`${config.explorerUrl}/address/${result.vault}`} target="_blank" rel="noreferrer"><small>vault</small><span>{result.vault}</span></a>
            <a href={`${config.explorerUrl}/address/${result.key}`} target="_blank" rel="noreferrer"><small>Agent Key</small><span>{result.key}</span></a>
          </div>
        </section>
      </div>

      <div className="command-center-footer">
        <span><Icon name="shield" /> Launch record saved in this browser at {formatSavedTime(sessionUpdatedAt)}. It contains public transaction metadata only.</span>
        <button type="button" onClick={onReset}>Start another Muppet</button>
      </div>
    </div>
  )
}

function keeperTiming(performance: MuppetPerformance | null, now: number): string {
  if (!performance?.keeper) return 'within five minutes'
  const next = Date.parse(performance.keeper.created_at) + 5 * 60_000
  if (!Number.isFinite(next) || next <= now) return 'due now'
  const seconds = Math.max(1, Math.ceil((next - now) / 1_000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function formatSavedTime(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'this session'
}

function shortHash(hash: Hash): string {
  return `${hash.slice(0, 8)}…${hash.slice(-5)}`
}
