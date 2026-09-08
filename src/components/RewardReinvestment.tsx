import { useEffect, useRef, useState } from 'react'
import { formatEther, parseEther, type Address, type Hash } from 'viem'
import type { ProtocolConfig, RevenueState } from '../lib/api'
import { getInjectedProvider, type AgentBondTerm } from '../lib/protocol'
import { executeReinvestment, quoteReinvestment, reconcileReinvestment, type ReinvestmentQuote } from '../lib/reinvest'

interface Props {
  config: ProtocolConfig
  account: Address
  metadata: RevenueState['reinvestment']
  positionId: bigint
  agentKey: Address
  claimable: bigint
  availableBoundKeys: bigint
  busy: boolean
  onBusy: (busy: boolean) => void
  onConfirmed: (hash: Hash) => void
}

export function RewardReinvestment(props: Props) {
  const { config, account, metadata, positionId, agentKey, claimable, availableBoundKeys, busy, onBusy, onConfirmed } = props
  const [amount, setAmount] = useState(() => formatEther(claimable))
  const [term, setTerm] = useState<AgentBondTerm>(0)
  const [slippage, setSlippage] = useState(100)
  const [quote, setQuote] = useState<ReinvestmentQuote | null>(null)
  const [working, setWorking] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<Hash | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const quoteGeneration = useRef(0)
  const storageKey = `liquidmuppets-reinvest:${config.chainId}:${config.agentBond}:${account.toLowerCase()}:${positionId}`

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      setSubmitted(saved && /^0x[a-fA-F0-9]{64}$/.test(saved) ? saved as Hash : null)
    } catch { /* Receipt links still work when browser storage is unavailable. */ }
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [storageKey])

  useEffect(() => {
    quoteGeneration.current += 1
    setQuote(null); setAccepted(false)
  }, [amount, term, slippage, claimable, account, agentKey, availableBoundKeys, metadata?.available, metadata?.executor])

  const input = () => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) throw new Error('Enter a WETH amount with at most 18 decimal places.')
    const wethToSpend = parseEther(amount)
    if (wethToSpend <= 0n || wethToSpend > claimable) throw new Error('Choose an amount within this position’s claimable WETH.')
    return { positionId, key: agentKey, units: 1n, term, wethToSpend, slippageBps: slippage }
  }
  const context = () => {
    const provider = getInjectedProvider()
    if (!provider) throw new Error('Connect your wallet to continue.')
    return { config, provider, account, metadata, input: input() }
  }
  const clearSubmitted = () => {
    setSubmitted(null)
    try { localStorage.removeItem(storageKey) } catch { /* Storage is optional. */ }
  }
  const rememberSubmitted = (hash: Hash) => {
    setSubmitted(hash)
    try { localStorage.setItem(storageKey, hash) } catch { /* Keep the visible receipt. */ }
  }
  const getQuote = async () => {
    const generation = ++quoteGeneration.current
    setWorking(true); setError(''); setQuote(null); setAccepted(false)
    try {
      const nextQuote = await quoteReinvestment(context())
      if (generation === quoteGeneration.current) setQuote(nextQuote)
    }
    catch (reason) { if (generation === quoteGeneration.current) setError(readableError(reason)) }
    finally { setWorking(false) }
  }
  const execute = async () => {
    if (!quote || !accepted || submitted) return
    setWorking(true); onBusy(true); setError('')
    try {
      const receipt = await executeReinvestment({ ...context(), quote, onSubmitted: rememberSubmitted })
      clearSubmitted(); setQuote(null); setAccepted(false); onConfirmed(receipt.transactionHash)
    } catch (reason) { setError(readableError(reason)); setQuote(null); setAccepted(false) }
    finally { setWorking(false); onBusy(false) }
  }
  const checkReceipt = async () => {
    if (!submitted) return
    setWorking(true); setError('')
    try {
      const receipt = await reconcileReinvestment({ config, account, hash: submitted, positionId })
      clearSubmitted()
      if (receipt.status === 'success') onConfirmed(receipt.transactionHash)
      else setError('The transaction reverted. Rewards and the original bond are unchanged; network gas was still charged.')
    } catch { setError('Confirmation is not available yet. Check the receipt before trying again.') }
    finally { setWorking(false) }
  }
  const days = [30, 90, 180][term]
  const unavailable = !metadata?.available || availableBoundKeys < 1n || claimable <= 0n
  const disabled = busy || working || unavailable || Boolean(submitted)
  const expired = Boolean(quote && now >= quote.expiresAt)

  return (
    <section className="reward-reinvestment" aria-label={`Reinvest position ${positionId}`}>
      <header><h3>Buy more and stake</h3><p>Use rewards from this position to buy $MUPPETS and open one new 15,000-token bond. Your original lock stays unchanged.</p></header>
      {!metadata?.available && <p role="status">{metadata?.reason ?? 'Reinvestment is awaiting verified contract activation.'}</p>}
      {availableBoundKeys < 1n && <p role="status">One unused, permanently bound Key is required. You can still claim your WETH without binding another Key.</p>}
      <div className="reinvest-fields">
        <label>WETH to spend<input inputMode="decimal" value={amount} disabled={disabled} onChange={(event) => setAmount(event.target.value)} aria-label="WETH to spend" /></label>
        <label>New bond term<select value={term} disabled={disabled} onChange={(event) => setTerm(Number(event.target.value) as AgentBondTerm)}><option value={0}>30 days</option><option value={1}>90 days</option><option value={2}>180 days</option></select></label>
        <label>Slippage limit<select value={slippage} disabled={disabled} onChange={(event) => setSlippage(Number(event.target.value))}><option value={50}>0.5%</option><option value={100}>1%</option><option value={200}>2%</option><option value={300}>3%</option></select></label>
      </div>
      <p>Claimable: {formatEther(claimable)} WETH. Gas is paid separately in ETH. The purchase must cover 15,000 $MUPPETS without using your existing token balance.</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void getQuote()}>{working ? 'Checking wallet and route…' : 'Get quote'}</button>
      {quote && <div className="reinvest-quote">
        <dl>
          <div><dt>Spend from rewards</dt><dd>{formatEther(quote.wethToSpend)} WETH</dd></div>
          <div><dt>Expected purchase</dt><dd>{formatEther(quote.quotedOutput)} $MUPPETS</dd></div>
          <div><dt>Minimum purchase</dt><dd>{formatEther(quote.minimumOutput)} $MUPPETS</dd></div>
          <div><dt>New bond</dt><dd>15,000 $MUPPETS · {days} days</dd></div>
          <div><dt>WETH returned to wallet</dt><dd>{formatEther(quote.remainderWeth)} WETH</dd></div>
          <div><dt>Estimated network gas</dt><dd>{formatEther(quote.nativeGasCost)} ETH</dd></div>
        </dl>
        <p>Any purchased $MUPPETS above 15,000 return to your wallet. Claim, purchase and bond either all succeed or all revert. A reverted transaction still costs gas.</p>
        <label className="reinvest-consent"><input type="checkbox" checked={accepted} disabled={disabled || expired} onChange={(event) => setAccepted(event.target.checked)} /><span>I accept a new {days}-day lock with no early exit. The Key stays permanently bound. Future rewards are variable and can be zero.</span></label>
        <p role="status">{expired ? 'Quote expired. Get a fresh quote to continue.' : `Quote expires in ${Math.max(0, quote.expiresAt - now)} seconds.`}</p>
        <button type="button" className="secondary" disabled={disabled || !accepted || expired} onClick={() => void execute()}>Confirm buy and stake</button>
      </div>}
      {submitted && <div className="reinvest-receipt"><a href={`${config.explorerUrl}/tx/${submitted}`} target="_blank" rel="noreferrer">View submitted transaction ↗</a><button type="button" className="secondary" disabled={working} onClick={() => void checkReceipt()}>Check confirmation</button><p>This transaction is already submitted. No duplicate will be sent from this form.</p></div>}
      {error && <p className="reinvest-error" role="alert">{error}</p>}
    </section>
  )
}

function readableError(reason: unknown): string {
  if (reason instanceof Error) return reason.message.split('\n\n')[0]
  return 'The transaction could not be prepared. Your wallet has not approved a new purchase.'
}
