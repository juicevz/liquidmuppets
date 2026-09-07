import { useEffect, useMemo, useState } from 'react'
import { parseUnits, type Address, type Hash } from 'viem'
import { CreatorSlots } from '../components/CreatorSlots'
import { Icon } from '../components/Icon'
import { pets } from '../data/pets'
import { defaultMarketForTask } from '../data/strategyMarkets'
import { useProtocol } from '../hooks/useProtocol'
import {
  fetchMuppetPerformance,
  fetchTokenAccess,
  type MuppetPerformance,
  type ProtocolConfig,
  type TokenAccess,
} from '../lib/api'
import { actionErrorMessage } from '../lib/errors'
import {
  DEFAULT_AGENT_KEY_LISTING_QUANTITY,
  DEFAULT_AGENT_KEY_REFERENCE_PRICE_ETH,
  DEFAULT_AGENT_KEY_SUPPLY,
  defaultFundingAmount,
  deriveAgentKeySymbol,
} from '../lib/launchDefaults'
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
  openAgentKeyMarket,
  previewVaultDeposit,
  type ChainAgent,
  type LaunchCheckpoint,
  type LaunchInput,
  type LaunchResult,
  type VaultFundingTarget,
} from '../lib/protocol'
import type { StrategyTaskId } from '../types'

interface CreateAgentPageProps {
  creatorHandle: string
  walletAddress?: string
  onConnect: () => void
}

const steps = ['Pet + name', 'Choose job', 'Launch + fund'] as const

const jobDetails: Record<0 | 1 | 2, {
  title: string
  summary: string
  movement: string
  guardrail: string
  deployed: string
  idle: string
  risk: string
}> = {
  0: {
    title: 'Earn on stablecoins',
    summary: 'Deposit USDG. The vault can supply part of it to one fixed Morpho Blue market.',
    movement: 'The keeper checks the market, utilization, oracle and vault cap before allocating.',
    guardrail: 'Withdrawals depend on available market liquidity. Interest is variable and no APY is promised.',
    deployed: 'up to 90%',
    idle: 'at least 10%',
    risk: 'lower',
  },
  1: {
    title: 'Run an ETH range',
    summary: 'Deposit WETH. The vault can open a bounded WETH / USDG liquidity range.',
    movement: 'The keeper can open or recenter the range when policy and cooldown checks pass.',
    guardrail: 'Price movement and range position affect results. EZManager currently charges a 0.4% entry fee.',
    deployed: 'up to 85%',
    idle: 'at least 15%',
    risk: 'higher',
  },
  2: {
    title: 'Keep a launch reserve',
    summary: 'Deposit WETH. The vault can stage a small amount in its isolated launch reserve.',
    movement: 'The keeper can stage or recall the reserve inside the vault policy.',
    guardrail: 'The staged WETH remains recallable. This route does not earn external pool fees.',
    deployed: 'up to 10%',
    idle: 'at least 90%',
    risk: 'limited route',
  },
}

export function CreateAgentPage({ creatorHandle, walletAddress, onConnect }: CreateAgentPageProps) {
  const { config, snapshot, tasks, loading, error, refresh } = useProtocol(walletAddress)
  const [step, setStep] = useState(0)
  const [petId, setPetId] = useState(0)
  const [taskId, setTaskId] = useState<StrategyTaskId>(0)
  const [presetId, setPresetId] = useState<0 | 1 | 2>(1)
  const [name, setName] = useState('')
  const [fundAmount, setFundAmount] = useState(defaultFundingAmount(0))
  const [progress, setProgress] = useState('')
  const [launchError, setLaunchError] = useState('')
  const [launching, setLaunching] = useState(false)
  const [session, setSession] = useState<LaunchSession | null>(null)
  const [access, setAccess] = useState<TokenAccess | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)

  const pet = pets[petId]
  const liveTasks = tasks.filter((item) => item.live && item.id <= 2)
  const task = liveTasks.find((item) => item.id === taskId)
  const market = defaultMarketForTask(taskId)
  const detail = taskId <= 2 ? jobDetails[taskId as 0 | 1 | 2] : jobDetails[0]
  const route = task ? (config?.mode === 'testnet' ? task.testnet_route : task.production_route) : ''
  const selectedPreset = task?.risk_presets[presetId]
  const keySymbol = deriveAgentKeySymbol(name, petId)
  const nameReady = name.trim().length >= 2 && name.trim().length <= 32
  const fundAmountValid = Number.isFinite(Number(fundAmount)) && Number(fundAmount) > 0
  const formReady = nameReady && fundAmountValid
  const routeCanLaunch = Boolean(config?.factory && formReady && task?.live && market.status === 'live')
  const recoveryReady = Boolean(config?.factory && formReady)
  const canLaunch = routeCanLaunch && (!walletAddress || access?.eligible === true)
  const checkpoint = session?.checkpoint ?? {}
  const result = launchResultFromCheckpoint(checkpoint)
  const launchStarted = launchHasStarted(checkpoint)
  const commandAgent = result ? snapshot?.agents.find((agent) => agent.id === result.agentId) : undefined
  const requiredMuppets = Number(access?.requiredForNextLaunch ?? config?.accessGate.slotSize ?? 15_000).toLocaleString('en-US')
  const canContinue = useMemo(
    () => step === 0 ? nameReady : step === 1 ? Boolean(task?.live) : false,
    [nameReady, step, task?.live],
  )

  useEffect(() => {
    if (!walletAddress) {
      setAccess(null)
      setAccessLoading(false)
      return
    }
    let active = true
    setAccessLoading(true)
    fetchTokenAccess(walletAddress)
      .then((next) => { if (active) setAccess(next) })
      .catch(() => { if (active) setAccess(null) })
      .finally(() => { if (active) setAccessLoading(false) })
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
    setPresetId(stored.input.presetId ?? 1)
    setName(stored.input.name)
    setFundAmount(stored.input.fundAmount ?? defaultFundingAmount(stored.input.taskId))
    setStep(2)
    setProgress(launchResultFromCheckpoint(stored.checkpoint)
      ? 'Muppet launched. Fund the vault when ready. The Agent Key market is a separate optional step.'
      : 'Recovered an unfinished launch. Continue from the saved creation receipt.')
  }, [config?.chainId, config?.factory, walletAddress])

  useEffect(() => {
    if (!result || commandAgent) return
    refresh()
  }, [commandAgent, refresh, result?.agentId])

  const selectTask = (nextTaskId: StrategyTaskId) => {
    setTaskId(nextTaskId)
    setFundAmount(defaultFundingAmount(nextTaskId))
  }

  const persistSession = (next: LaunchSession) => {
    saveLaunchSession(window.localStorage, next)
    setSession(next)
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
      keySymbol,
      keySupply: DEFAULT_AGENT_KEY_SUPPLY,
      listingQuantity: DEFAULT_AGENT_KEY_LISTING_QUANTITY,
      floorPriceEth: DEFAULT_AGENT_KEY_REFERENCE_PRICE_ETH,
      fundAmount,
      presetId: config.factoryVersion >= 2 && task?.risk_presets.length ? presetId : undefined,
    }
    let activeSession = session ?? createLaunchSession(
      config.chainId,
      config.factory,
      walletAddress as Address,
      input,
    )
    try {
      if (!launchHasStarted(activeSession.checkpoint)) {
        setProgress('Checking your Creator Slot…')
        const latestAccess = await fetchTokenAccess(walletAddress)
        setAccess(latestAccess)
        if (!latestAccess.eligible) {
          const required = Number(latestAccess.requiredForNextLaunch ?? latestAccess.minimum).toLocaleString('en-US')
          throw new Error(latestAccess.reason === 'token_not_configured'
            ? 'The canonical $MUPPETS contract address is required to calculate Creator Slots.'
            : latestAccess.reason === 'access_check_unavailable'
              ? 'Creator Slot verification is temporarily unavailable. No transaction was sent.'
              : `Hold ${required} $MUPPETS to unlock your next Creator Slot.`)
        }
      }
      await launchAgent(config, provider, walletAddress as Address, input, {
        checkpoint: activeSession.checkpoint,
        onProgress: setProgress,
        onCheckpoint: (nextCheckpoint) => {
          activeSession = withLaunchCheckpoint(activeSession, nextCheckpoint)
          persistSession(activeSession)
        },
      })
      setProgress('Muppet launched. Fund the vault when ready. The Agent Key market is still closed.')
      refresh()
    } catch (reason) {
      setLaunchError(actionErrorMessage(reason, 'The launch failed.'))
      setProgress(launchHasStarted(activeSession.checkpoint)
        ? 'Launch paused. The submitted creation receipt is saved in this browser.'
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
    setPresetId(1)
    setName('')
    setFundAmount(defaultFundingAmount(0))
    setProgress('')
    setLaunchError('')
  }

  return (
    <div className="app-page create-page guided-create-page">
      <section className="app-page-heading guided-create-heading">
        <div>
          <span className="guided-create-kicker"><i /> three clear steps</span>
          <h1>{result ? 'Your Muppet is live.' : 'Create a Muppet.'}</h1>
          <p>{result
            ? 'Fund its vault, watch the keeper and share its public record. The Agent Key market stays separate.'
            : 'Pick a pet, give its vault one job, then launch and fund it. The pet is cosmetic.'}</p>
        </div>
      </section>

      <div className="creator-capacity-strip">
        <CreatorSlots
          access={access}
          connected={Boolean(walletAddress)}
          loading={accessLoading}
          slotSize={config?.accessGate.slotSize}
          explorerUrl={config?.explorerUrl}
          tokenAddress={config?.accessGate.tokenAddress}
        />
      </div>

      {(error || launchError) && <div className="protocol-error" role="alert"><Icon name="alert" />{launchError || error}</div>}

      {result && config && session ? (
        <LaunchCommandCenter
          agent={commandAgent}
          chainLoading={loading}
          config={config}
          session={session}
          result={result}
          wallet={walletAddress as Address}
          onRefresh={refresh}
          onReset={resetLaunch}
          onSessionChange={persistSession}
        />
      ) : (
        <section className="guided-builder-shell">
          <aside className="guided-builder-steps" aria-label="Muppet creation steps">
            <span className="guided-steps-label">create flow</span>
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                disabled={launchStarted}
                className={`${step === index ? 'active' : ''}${step > index ? ' complete' : ''}`}
                onClick={() => setStep(index)}
              >
                <span>{step > index ? <Icon name="check" /> : index + 1}</span>
                <strong>{label}</strong>
              </button>
            ))}
            <div className="guided-wallet-note">
              <Icon name="shield" />
              <span><strong>One launch confirmation.</strong><small>Funding and an optional Key listing happen separately.</small></span>
            </div>
          </aside>

          <div className="guided-builder-content">
            {step === 0 && (
              <div className="guided-builder-stage">
                <span className="builder-step-number">01 / PET + NAME</span>
                <h2>Make it yours.</h2>
                <p className="guided-stage-intro">The pet is the public identity. It does not change the vault, permissions or risk.</p>
                <label className="guided-name-field">
                  <span>Muppet name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} placeholder="quiet fox" autoFocus />
                  <small>{name.trim().length}/32 characters</small>
                </label>
                <div className="guided-pet-grid" role="group" aria-label="Choose pet appearance">
                  {pets.map((item) => (
                    <button type="button" className={petId === item.id ? 'active' : ''} onClick={() => setPetId(item.id)} key={item.id}>
                      <img src={item.portrait} alt={`${item.name} pet`} />
                      <span>{item.name}</span>
                      <i aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="guided-builder-stage">
                <span className="builder-step-number">02 / CHOOSE ONE JOB</span>
                <h2>What should its vault do?</h2>
                <p className="guided-stage-intro">These are the three routes live today. Every job fixes the deposit asset, maximum deployment and idle reserve.</p>
                <div className="guided-job-grid" role="group" aria-label="Choose a live vault job">
                  {liveTasks.map((item) => {
                    const itemDetail = jobDetails[item.id as 0 | 1 | 2]
                    return (
                      <button type="button" aria-pressed={taskId === item.id} className={taskId === item.id ? 'active' : ''} onClick={() => selectTask(item.id)} key={item.id}>
                        <span className="guided-job-top"><b><i /> live</b><small>{itemDetail.risk}</small></span>
                        <Icon name={item.id === 0 ? 'layers' : item.id === 1 ? 'spark' : 'shield'} />
                        <strong>{itemDetail.title}</strong>
                        <p>{itemDetail.summary}</p>
                        <span className="guided-job-split"><small>{itemDetail.deployed} deployed</small><small>{itemDetail.idle} idle</small></span>
                      </button>
                    )
                  })}
                </div>

                {task && (
                  <details className="guided-advanced">
                    <summary>Advanced details <Icon name="chevron" /></summary>
                    <div className="guided-advanced-grid">
                      <div><small>exact route</small><strong>{route}</strong><p>{detail.movement}</p></div>
                      <div><small>asset + market</small><strong>{task.deposit_asset} · {market.market}</strong><p>{detail.guardrail}</p></div>
                      <div><small>checks</small><ul>{market.checks.map((check) => <li key={check}><Icon name="check" />{check}</li>)}</ul></div>
                    </div>
                    {task.risk_presets.length > 0 && (
                      <div className="guided-preset-picker" role="group" aria-label="FactoryV2 risk preset">
                        {task.risk_presets.map((preset, index) => (
                          <button
                            type="button"
                            className={presetId === index ? 'active' : ''}
                            disabled={(config?.factoryVersion ?? 1) < 2}
                            onClick={() => setPresetId(index as 0 | 1 | 2)}
                            key={preset.id}
                          >
                            <strong>{preset.id}</strong>
                            <small>{preset.max_allocation_bps / 100}% max · {preset.cooldown_seconds / 3600}h cooldown</small>
                          </button>
                        ))}
                        {(config?.factoryVersion ?? 1) < 2 && <p>Preset selection activates after the FactoryV2 migration.</p>}
                      </div>
                    )}
                  </details>
                )}

                <div className="guided-key-boundary"><Icon name="key" /><span><strong>Agent Keys are separate.</strong><small>A Key market is optional after launch. Keys do not own vault assets or receive vault yield.</small></span></div>
              </div>
            )}

            {step === 2 && (
              <div className="guided-builder-stage guided-launch-stage">
                <span className="builder-step-number">03 / LAUNCH + FUND</span>
                <h2>{launchStarted ? 'Finish this launch.' : 'Review the money path.'}</h2>
                <div className="guided-launch-review">
                  <div className="guided-review-identity"><img src={pet.portrait} alt="" /><span><small>Muppet</small><strong>{name || pet.name}</strong><em>{creatorHandle}</em></span></div>
                  <div><small>job</small><strong>{detail.title}</strong></div>
                  <div><small>deposit</small><strong>{task?.deposit_asset ?? 'loading'}</strong></div>
                  <div><small>deployed</small><strong>{detail.deployed}</strong></div>
                  <div><small>idle</small><strong>{detail.idle}</strong></div>
                  <div className="guided-review-market"><small>market</small><strong>{market.market}</strong></div>
                  {selectedPreset && config?.factoryVersion && config.factoryVersion >= 2 && <div><small>risk preset</small><strong>{selectedPreset.id}</strong></div>}
                </div>

                <label className="guided-fund-plan">
                  <span><strong>Planned first deposit</strong><small>This is remembered for the funding screen. It is not sent during launch.</small></span>
                  <div className="unit-input"><input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" /><b>{task?.deposit_asset ?? ''}</b></div>
                </label>

                <div className="guided-confirmation-path">
                  <span><b>1</b><strong>Launch Muppet</strong><small>one wallet confirmation</small></span>
                  <Icon name="arrow" />
                  <span><b>2</b><strong>Fund vault</strong><small>asset approval + deposit</small></span>
                  <Icon name="arrow" />
                  <span><b>3</b><strong>Keeper checks</strong><small>acts only when policy passes</small></span>
                </div>

                <div className="guided-factory-key-note">
                  <Icon name="key" />
                  <span><strong>The current factory also creates ${keySymbol} with the Muppet.</strong><small>No Keys are approved or listed during launch. Its speculative market stays closed unless you open one later.</small></span>
                </div>

                <div className={`launch-token-gate ${access?.eligible || launchStarted ? 'unlocked' : 'locked'}`}>
                  <Icon name={access?.eligible || launchStarted ? 'check' : 'lock'} />
                  <span>
                    <strong>{launchStarted ? 'Launch recovery ready.' : `${requiredMuppets} $MUPPETS unlocks your next Creator Slot.`}</strong>
                    <small>{launchStarted
                      ? 'This browser saved the submitted receipt. Resume checks it before doing anything else.'
                      : !walletAddress
                        ? 'Connect a wallet to check its Robinhood Chain balance.'
                        : accessLoading
                          ? 'Checking the connected wallet.'
                          : access?.eligible
                            ? `${access.balance} $MUPPETS verified. ${access.slotsAvailable} launch slot${access.slotsAvailable === 1 ? '' : 's'} available.`
                            : access?.reason === 'below_minimum' || access?.reason === 'capacity_full'
                              ? `Wallet balance: ${access.balance ?? '0'} $MUPPETS. Existing Muppets remain available.`
                              : 'Creator Slot verification is unavailable. No transaction will be sent.'}</small>
                  </span>
                </div>

                <button type="button" className="builder-primary guided-launch-button" disabled={launching || (launchStarted ? !recoveryReady : !canLaunch)} onClick={deploy}>
                  <Icon name={launchStarted ? 'receipt' : task?.live && !walletAddress ? 'wallet' : access?.eligible ? 'receipt' : 'lock'} /> {launching
                    ? 'Waiting for wallet'
                    : launchStarted
                      ? 'Resume launch'
                      : !walletAddress
                        ? 'Connect wallet'
                        : accessLoading
                          ? 'Checking $MUPPETS'
                          : access?.eligible
                            ? 'Launch Muppet'
                            : access?.reason === 'below_minimum' || access?.reason === 'capacity_full'
                              ? `Unlock at ${requiredMuppets} $MUPPETS`
                              : 'Slot check unavailable'}
                </button>
                {progress && <div className="transaction-progress" role="status"><Icon name="spark" />{progress}</div>}
                {session && config && <LaunchReceiptTracker checkpoint={session.checkpoint} explorerUrl={config.explorerUrl} />}
              </div>
            )}

            <div className="guided-builder-footer">
              <button type="button" className="builder-back" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || launchStarted}>Back</button>
              {step < steps.length - 1 && (
                <button type="button" className="builder-next" disabled={!canContinue} onClick={() => setStep(step + 1)}>
                  {step === 0 ? 'Choose one job' : 'Review launch + funding'} <Icon name="arrow" />
                </button>
              )}
            </div>
          </div>

          <aside className="guided-builder-preview">
            <span className="preview-label">YOUR MUPPET</span>
            <div className="guided-preview-pet"><img src={pet.portrait} alt="" /></div>
            <h3>{name || 'unnamed Muppet'}</h3>
            <p>{detail.title}</p>
            <div className="guided-preview-stats">
              <span><small>deposit asset</small><strong>{task?.deposit_asset ?? 'USDG'}</strong></span>
              <span><small>deployment</small><strong>{detail.deployed}</strong></span>
              <span><small>idle reserve</small><strong>{detail.idle}</strong></span>
            </div>
            <div className="guided-money-path">
              <small>money path</small>
              <span><b>wallet</b><Icon name="arrow" /><b>vault</b><Icon name="arrow" /><b>one job</b></span>
            </div>
            <p className="guided-preview-boundary">Vault shares represent deposited assets. $MUPPETS unlocks creator capacity. Agent Keys stay separate.</p>
          </aside>
        </section>
      )}
    </div>
  )
}

function LaunchReceiptTracker({ checkpoint, explorerUrl }: { checkpoint: LaunchCheckpoint; explorerUrl: string }) {
  const stage = { label: 'Muppet + vault', hash: checkpoint.createTx, confirmed: checkpoint.createConfirmed }
  return (
    <div className="launch-stage-list single-launch-stage" aria-label="Launch transaction receipt">
      <div className={`launch-stage ${stage.confirmed ? 'confirmed' : stage.hash ? 'submitted' : 'waiting'}`}>
        <span><b>{stage.confirmed ? <Icon name="check" /> : 1}</b><strong>{stage.label}</strong></span>
        {stage.hash ? (
          <a href={`${explorerUrl}/tx/${stage.hash}`} target="_blank" rel="noreferrer" title={stage.hash}>
            {stage.confirmed ? 'confirmed' : 'submitted'} · {shortHash(stage.hash)} <Icon name="arrow" />
          </a>
        ) : <small>waiting</small>}
      </div>
    </div>
  )
}

interface LaunchCommandCenterProps {
  agent?: ChainAgent
  chainLoading: boolean
  config: ProtocolConfig
  session: LaunchSession
  result: LaunchResult
  wallet: Address
  onRefresh: () => void
  onReset: () => void
  onSessionChange: (session: LaunchSession) => void
}

function LaunchCommandCenter({
  agent,
  chainLoading,
  config,
  session,
  result,
  wallet,
  onRefresh,
  onReset,
  onSessionChange,
}: LaunchCommandCenterProps) {
  const input = session.input
  const [fundAmount, setFundAmount] = useState(input.fundAmount ?? defaultFundingAmount(input.taskId))
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
  const [keyQuantity, setKeyQuantity] = useState(String(input.listingQuantity))
  const [keyPrice, setKeyPrice] = useState(input.floorPriceEth)
  const [keyProgress, setKeyProgress] = useState('')
  const [keyError, setKeyError] = useState('')
  const [openingKeyMarket, setOpeningKeyMarket] = useState(false)

  const performanceHref = performancePath(result.agentId)
  const performanceUrl = typeof window === 'undefined'
    ? `https://liquidmuppets.io${performanceHref}`
    : new URL(performanceHref, window.location.origin).href
  const taskLabel = input.taskId === 0 ? 'stablecoin lending' : input.taskId === 1 ? 'an ETH range' : 'a launch reserve'
  const shareText = `${input.name} is live on @liquidmuppets.\n\nOne policy-bound vault running ${taskLabel}, with public performance from its first recorded checkpoint.`
  const shareHref = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(performanceUrl)}`
  const fundingTarget: VaultFundingTarget | null = agent ?? directTarget
  const keyMarketOpen = Boolean(session.checkpoint.listingConfirmed && session.checkpoint.listingTx)
  const keyMarketStarted = Boolean(session.checkpoint.approveTx || session.checkpoint.listingTx)
  const parsedKeyQuantity = Number(keyQuantity)
  const keyFormReady = Boolean(
    config.keyMarketplace
    && Number.isInteger(parsedKeyQuantity)
    && parsedKeyQuantity >= 1
    && parsedKeyQuantity <= input.keySupply
    && Number.isFinite(Number(keyPrice))
    && Number(keyPrice) > 0,
  )
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

  const openKeyMarket = async () => {
    if (!keyFormReady || keyMarketOpen) return
    const provider = getInjectedProvider()
    if (!provider) {
      setKeyError('No injected wallet was found.')
      return
    }
    setOpeningKeyMarket(true)
    setKeyError('')
    let activeSession: LaunchSession = {
      ...session,
      input: {
        ...session.input,
        listingQuantity: parsedKeyQuantity,
        floorPriceEth: keyPrice,
      },
      updatedAt: new Date().toISOString(),
    }
    onSessionChange(activeSession)
    try {
      await openAgentKeyMarket(config, provider, wallet, result.key, parsedKeyQuantity, keyPrice, {
        checkpoint: activeSession.checkpoint,
        onProgress: setKeyProgress,
        onCheckpoint: (nextCheckpoint) => {
          activeSession = withLaunchCheckpoint(activeSession, nextCheckpoint)
          onSessionChange(activeSession)
        },
      })
      setKeyProgress('Agent Key market open. The listing receipts are saved below.')
      onRefresh()
    } catch (reason) {
      setKeyError(actionErrorMessage(reason, 'The Agent Key listing failed.'))
    } finally {
      setOpeningKeyMarket(false)
    }
  }

  return (
    <div className="launch-command-center simplified-command-center">
      <div className="command-center-heading">
        <div>
          <span>LAUNCH COMPLETE · MUPPET #{result.agentId.toString()}</span>
          <h2>Muppet live. Put the vault to work.</h2>
          <p>The launch is complete. Funding, keeper decisions and the optional Agent Key market remain distinct.</p>
        </div>
        <span className="command-center-live"><i /> live</span>
      </div>

      <LaunchReceiptTracker checkpoint={session.checkpoint} explorerUrl={config.explorerUrl} />

      <div className="command-center-grid">
        <section className="command-card funding-card">
          <div className="command-card-head"><Icon name="wallet" /><span><small>01</small><h3>Fund vault</h3></span></div>
          <p>Two wallet confirmations: approve the deposit asset, then deposit it into the ERC-4626 vault.</p>
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
              {fundReceipts[1] && <a href={`${config.explorerUrl}/tx/${fundReceipts[1]}`} target="_blank" rel="noreferrer">vault deposit <Icon name="arrow" /></a>}
            </div>
          )}
        </section>

        <section className="command-card keeper-card">
          <div className="command-card-head"><Icon name="clock" /><span><small>02</small><h3>Keeper checks</h3></span></div>
          <div className="keeper-next-time"><small>next automatic check</small><strong>{keeperTiming(performance, now)}</strong></div>
          {performance?.keeper ? (
            <div className="keeper-last-decision"><span><small>last decision</small><strong>{performance.keeper.action}</strong></span><p>{performance.keeper.reason}</p></div>
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

      <section className={`optional-key-market ${keyMarketOpen ? 'open' : 'closed'}`}>
        <div className="optional-key-heading">
          <Icon name="key" />
          <div><span>OPTIONAL · SEPARATE MARKET</span><h3>{keyMarketOpen ? 'Agent Key market open.' : `Open a market for $${input.keySymbol}`}</h3><p>Agent Keys are speculative collectibles. They do not own vault assets, receive vault yield or control the keeper.</p></div>
          <b><i /> {keyMarketOpen ? 'market open' : 'market closed'}</b>
        </div>
        {!keyMarketOpen && (
          <div className="optional-key-form">
            <label><span>Keys to list</span><input value={keyQuantity} disabled={keyMarketStarted} onChange={(event) => setKeyQuantity(event.target.value)} inputMode="numeric" /></label>
            <label><span>price per Key</span><div className="unit-input"><input value={keyPrice} disabled={Boolean(session.checkpoint.listingTx)} onChange={(event) => setKeyPrice(event.target.value)} inputMode="decimal" /><b>ETH</b></div></label>
            <button type="button" className="command-secondary" disabled={!keyFormReady || openingKeyMarket} onClick={openKeyMarket}><Icon name="key" />{openingKeyMarket ? 'Waiting for wallet' : keyMarketStarted ? 'Resume Key market' : 'Approve + open listing'}</button>
          </div>
        )}
        <p className="optional-key-confirmations">Opening the market uses two confirmations: approve only the selected Keys, then create the listing.</p>
        {keyProgress && <div className="transaction-notice" role="status"><Icon name="check" />{keyProgress}</div>}
        {keyError && <div className="transaction-notice error" role="alert"><Icon name="alert" />{keyError}</div>}
        {(session.checkpoint.approveTx || session.checkpoint.listingTx) && <KeyMarketReceiptTracker checkpoint={session.checkpoint} explorerUrl={config.explorerUrl} />}
      </section>

      <div className="command-center-footer">
        <span><Icon name="shield" /> Public receipt metadata was saved in this browser at {formatSavedTime(session.updatedAt)}.</span>
        <button type="button" onClick={onReset}>Start another Muppet</button>
      </div>
    </div>
  )
}

function KeyMarketReceiptTracker({ checkpoint, explorerUrl }: { checkpoint: LaunchCheckpoint; explorerUrl: string }) {
  const stages = [
    { label: 'Key approval', hash: checkpoint.approveTx, confirmed: checkpoint.approveConfirmed },
    { label: 'Key listing', hash: checkpoint.listingTx, confirmed: checkpoint.listingConfirmed },
  ]
  return (
    <div className="launch-stage-list key-stage-list" aria-label="Agent Key market receipts">
      {stages.map((stage, index) => (
        <div className={`launch-stage ${stage.confirmed ? 'confirmed' : stage.hash ? 'submitted' : 'waiting'}`} key={stage.label}>
          <span><b>{stage.confirmed ? <Icon name="check" /> : index + 1}</b><strong>{stage.label}</strong></span>
          {stage.hash ? <a href={`${explorerUrl}/tx/${stage.hash}`} target="_blank" rel="noreferrer">{stage.confirmed ? 'confirmed' : 'submitted'} · {shortHash(stage.hash)} <Icon name="arrow" /></a> : <small>waiting</small>}
        </div>
      ))}
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
