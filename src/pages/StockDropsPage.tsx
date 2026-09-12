import { useEffect, useState } from 'react'
import { BaseError, type Address, type Hash } from 'viem'
import { Icon } from '../components/Icon'
import { formatEarnAmount } from '../lib/earn'
import { shortenAddress } from '../lib/format'
import { getInjectedProvider } from '../lib/protocol'
import {
  claimStockDrop, fetchStockDrops, pendingStockClaim, reconcileStockClaim,
  type FundedDrop, type StockDropState,
} from '../lib/stockDrops'
import './stockDrops.css'

interface Props { walletAddress?: string; onConnect: () => Promise<void> }

export function StockDropsPage({ walletAddress, onConnect }: Props) {
  const [state, setState] = useState<StockDropState | null>(null)
  const [error, setError] = useState('')
  const [before, setBefore] = useState<number | undefined>()
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    let running = false
    const load = async () => {
      if (running) return
      running = true
      try {
        const next = await fetchStockDrops(walletAddress, before)
        if (active) { setState(next); setError('') }
      } catch (reason) {
        if (active) setError(message(reason))
      } finally { running = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [walletAddress, before, refresh])
  const ready = Boolean(state && state.wallet === (walletAddress?.toLowerCase() ?? null) && !error)
  const available = ready && state?.status === 'available'
  const funded = state?.drops.filter((drop): drop is FundedDrop => drop.status === 'funded') ?? []

  return <div className="app-page stock-drops-page">
    <nav className="earn-tabs" aria-label="Earn features"><a href="/app/earn">Agent Bonds</a><a href="/app/stock-drops" aria-current="page">Stock Drops</a></nav>
    <header className="drops-hero">
      <div><span className="drops-kicker">for $MUPPETS holders</span><h1>Stock Drops.</h1><p>Funded stock-token drops, claimed into your wallet. Your allocation follows a published $MUPPETS snapshot.</p></div>
      <button className="drops-secondary" type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh <Icon name="arrow" /></button>
    </header>
    {error && <p className="drops-error" role="alert">{error} Claims are unavailable until the page reconnects.</p>}
    <div className="drops-grid">
      <div className="drops-desk">
        {!ready || state?.status === 'unavailable' ? <section className="drops-empty" role="status"><Icon name="clock" /><h2>{error || state?.status === 'unavailable' ? 'Evidence is reconnecting.' : 'Reading Stock Drops.'}</h2><p>{state?.status === 'unavailable' ? state.reason : 'Funding and allocations appear after their chain evidence is checked.'}</p></section>
          : state?.drops.length ? state.drops.map((drop) => drop.status === 'funded'
            ? <DropCard key={`${state.contract}-${drop.id}-${walletAddress}`} state={state} drop={drop} account={walletAddress as Address | undefined} enabled={Boolean(available)} onConnect={onConnect} onRefresh={() => setRefresh((value) => value + 1)} />
            : <section className="drops-empty" key={drop.id}><Icon name="alert" /><h2>Drop #{drop.id} is unavailable.</h2><p>The allocation file or funding evidence could not be verified. Try refreshing.</p></section>)
          : <section className="drops-empty">
            <div className="drops-stamps" aria-label="Initial supported stock tokens">{['AAPL', 'AMD', 'AMZN', 'ASML'].map((symbol) => <span key={symbol}>{symbol}</span>)}</div>
            <Icon name="receipt" /><span className="drops-kicker">first drop</span><h2>Waiting for a funded pot.</h2><p>The first drop needs a published snapshot and a deposited stock-token budget. There is no holder payout to claim yet.</p>
            <dl className="drops-empty-status"><div><dt>Funding</dt><dd>Awaiting first drop</dd></div><div><dt>Snapshot</dt><dd>Not published</dd></div></dl>
          </section>}
        {(before !== undefined || state?.next_before != null) && <nav className="drops-pagination" aria-label="Stock Drop pages"><button type="button" className="drops-secondary" disabled={before === undefined} onClick={() => setBefore(undefined)}>Latest drops</button><button type="button" className="drops-secondary" disabled={!available || state?.next_before == null} onClick={() => { if (state?.next_before != null) setBefore(state.next_before) }}>Older drops</button></nav>}
      </div>
      <aside className="drops-sidebar">
        <section className="drops-wallet"><header><Icon name="wallet" /><h2>Your allocation</h2></header>
          {walletAddress ? <><strong className="drops-account">{shortenAddress(walletAddress)}</strong><p>{available && funded.length ? 'Your allocation and claim status are shown on each funded drop.' : 'Your allocation will appear after a funded snapshot is published.'}</p></>
            : <><p>Connect to check your allocation in each published drop.</p><button type="button" className="drops-primary" onClick={() => void onConnect()}>Connect Rabby <Icon name="arrow" /></button></>}
          <div className="drops-unit"><span>one allocation unit</span><strong>15,000 $MUPPETS</strong><p>Each full unit held in your wallet at the snapshot counts. Partial units round down. No Key, lock or token approval is needed.</p></div>
        </section>
        <section className="drops-funding"><h2>What funds a drop?</h2><p>Each drop needs a separately approved and deposited stock-token budget. Size and timing depend on available funding.</p><p>Vault deposits and the existing stock reserve are separate. Stock Drops has no automatic fee feed.</p></section>
      </aside>
    </div>
    <ol className="drops-steps">
      <li><span>01</span><h2>Published snapshot</h2><p>Your whole 15,000-token units determine your share of the eligible total. Excluded wallets and reasons are published.</p></li>
      <li><span>02</span><h2>Fully funded pot</h2><p>The publisher deposits the entire stock-token budget and commits the allocation. Each drop holds one stock asset.</p></li>
      <li><span>03</span><h2>Claim to your wallet</h2><p>One claim per drop sends your allocation to your wallet. You pay network gas in ETH. Funded claims have no expiry.</p></li>
    </ol>
    <footer className="drops-disclosure"><p>The publisher chooses the snapshot and exclusions. The contract enforces the committed allocation; it does not check historical $MUPPETS balances itself. Buying after a snapshot does not change that drop. Tokens held in pools, exchanges or other contracts are not automatically attributed to you.</p><p>Stock tokens carry issuer and transfer restrictions. Reward size and token value can change between drops. No fixed return is promised.</p><a href="/docs#stock-drops">Read the Stock Drops rules <Icon name="arrow" /></a>{state?.block_number != null && <span>Read at block {state.block_number.toLocaleString('en-US')}</span>}</footer>
  </div>
}

function DropCard({ state, drop, account, enabled, onConnect, onRefresh }: {
  state: StockDropState; drop: FundedDrop; account?: Address; enabled: boolean;
  onConnect: () => Promise<void>; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<Hash | null>(() => account ? pendingStockClaim(state, drop.id, account) : null)
  const [confirmed, setConfirmed] = useState<Hash | null>(null)
  const allocation = drop.allocation
  const remember = (hash: Hash) => setSubmitted(hash)
  const claim = async () => {
    const provider = getInjectedProvider()
    if (!account || !provider || busy || submitted || !enabled) return
    setBusy(true); setError('')
    try {
      const hash = await claimStockDrop(state, drop, provider, account, remember)
      setSubmitted(null); setConfirmed(hash); onRefresh()
    } catch (reason) {
      setError(message(reason)); setSubmitted(pendingStockClaim(state, drop.id, account))
    } finally { setBusy(false) }
  }
  const check = async () => {
    if (!account || busy) return
    setBusy(true); setError('')
    try {
      const receipt = await reconcileStockClaim(state, drop, account)
      setSubmitted(null)
      if (receipt.status === 'success') setConfirmed(receipt.transactionHash)
      else setError('The claim reverted. Your allocation remains available; network gas was charged.')
      onRefresh()
    } catch { setError('Confirmation is not readable yet. Check the submitted receipt before trying again.') }
    finally { setBusy(false) }
  }
  return <section className="drop-card" aria-label={`Stock Drop ${drop.id}`}>
    <header><div><span className="drops-kicker">drop #{drop.id}</span><h2>{drop.symbol} <span>Stock Token</span></h2></div><span className="drop-funded"><Icon name="check" />Funded</span></header>
    <dl className="drop-totals"><div><dt>Total funded</dt><dd>{formatEarnAmount(drop.funded_raw, drop.symbol)}</dd></div><div><dt>Claimed by holders</dt><dd>{formatEarnAmount(drop.claimed_raw, drop.symbol)}</dd></div><div><dt>Still allocated</dt><dd>{formatEarnAmount(drop.remaining_raw, drop.symbol)}</dd></div></dl>
    <div className="drop-allocation">
      {!account ? <><p>Connect to check your share of this drop.</p><button className="drops-primary" type="button" onClick={() => void onConnect()}>Connect Rabby</button></>
        : !allocation ? <p>This wallet has no allocation in this snapshot.</p>
        : <><div><span>Your allocation · {allocation.units} units</span><strong>{formatEarnAmount(allocation.amount_raw, drop.symbol, 10)}</strong><small>{allocation.claimed || confirmed ? 'Claimed to your wallet' : 'Ready to claim · gas paid in ETH'}</small></div><button type="button" className="drops-primary" disabled={!enabled || busy || Boolean(submitted) || Boolean(confirmed) || allocation.claimed} onClick={() => void claim()}>{busy ? 'Checking wallet…' : submitted ? 'Claim submitted' : allocation.claimed || confirmed ? 'Claimed' : `Claim ${drop.symbol}`}</button></>}
    </div>
    {(submitted || confirmed) && <div className="drop-receipt" role="status"><a href={`${state.explorer_url}/tx/${submitted ?? confirmed}`} target="_blank" rel="noreferrer">{confirmed ? 'Confirmed receipt' : 'Submitted transaction'} ↗</a>{submitted && <button type="button" className="drops-secondary" disabled={busy || !enabled} onClick={() => void check()}>Check confirmation</button>}</div>}
    {error && <p className="drops-error" role="alert">{error}</p>}
    <div className="drop-evidence"><a href={`${state.explorer_url}/block/${drop.snapshot_block}`} target="_blank" rel="noreferrer">Snapshot {drop.snapshot_block.toLocaleString('en-US')} ↗</a><a href={drop.manifest_url} target="_blank" rel="noreferrer">Full allocation file ↗</a><a href={`${state.explorer_url}/address/${state.contract}`} target="_blank" rel="noreferrer">Funding contract ↗</a></div>
    <details><summary>Allocation rules and exclusions</summary><p>{drop.eligible_wallets} eligible wallets · {drop.total_units} total units. Every allocated raw token unit is included in the public file.</p>{drop.exclusions.length ? <ul>{drop.exclusions.map((row) => <li key={row.account}><code>{row.account}</code>: {row.reason}</li>)}</ul> : <p>No wallets were explicitly excluded in this drop.</p>}<p>Root: <code>{drop.root}</code></p></details>
  </section>
}

function message(reason: unknown): string {
  return reason instanceof BaseError ? reason.shortMessage : reason instanceof Error ? reason.message : 'The request did not complete.'
}
