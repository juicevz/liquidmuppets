import { useEffect, useState } from 'react'
import { toHex } from 'viem'
import type { View } from '../types'
import { shortenAddress } from '../lib/format'
import { connectWallet, getConnectedWallet } from '../lib/wallet'
import { claimWalletProfile, createProfileChallenge, fetchWalletProfile } from '../lib/api'
import { getInjectedProvider } from '../lib/protocol'
import { Brand } from './Brand'
import { HandleModal } from './HandleModal'
import { HeaderSocialLinks } from './HeaderSocialLinks'
import { Icon } from './Icon'
import { CreateAgentPage } from '../pages/CreateAgentPage'
import { DocsPage } from '../pages/DocsPage'
import { MarketplacePage } from '../pages/MarketplacePage'
import { PortfolioPage } from '../pages/PortfolioPage'

interface AppShellProps {
  view: Exclude<View, 'landing'>
  onNavigate: (view: View) => void
}

type WalletState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'connected'; address: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export function AppShell({ view, onNavigate }: AppShellProps) {
  const [wallet, setWallet] = useState<WalletState>({ status: 'idle' })
  const [handle, setHandle] = useState<string | null>(null)
  const [showHandle, setShowHandle] = useState(false)

  useEffect(() => {
    let active = true
    getConnectedWallet()
      .then((address) => {
        if (active && address) setWallet({ status: 'connected', address })
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (wallet.status !== 'connected') {
      setHandle(null)
      return
    }
    let active = true
    fetchWalletProfile(wallet.address)
      .then((profile) => {
        if (!active) return
        setHandle(profile ? `@${profile.handle}` : null)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [wallet])

  const requestWallet = async () => {
    setWallet({ status: 'connecting' })
    try {
      const address = await connectWallet()
      setWallet({ status: 'connected', address })
    } catch (error) {
      if ((error as Error).message === 'NO_PROVIDER') {
        setWallet({ status: 'missing' })
        return
      }
      setWallet({ status: 'error', message: 'Connection cancelled or unavailable.' })
    }
  }

  const saveHandle = async (next: string) => {
    if (wallet.status !== 'connected') {
      await requestWallet()
      throw new Error('Connect the wallet, then sign the handle once more.')
    }
    const provider = getInjectedProvider()
    if (!provider) throw new Error('No injected wallet found.')
    const clean = next.replace(/^@/, '')
    const challenge = await createProfileChallenge(wallet.address, clean)
    const signature = await provider.request({
      method: 'personal_sign',
      params: [toHex(challenge.message), wallet.address],
    })
    if (typeof signature !== 'string') throw new Error('Wallet did not return a signature.')
    const profile = await claimWalletProfile(wallet.address, clean, challenge.nonce, signature)
    setHandle(`@${profile.handle}`)
    setShowHandle(false)
  }

  return (
    <div className="app-shell">
      <div className="app-noise" aria-hidden="true" />
      <header className="app-header">
        <button type="button" className="brand-button" onClick={() => onNavigate('landing')}>
          <Brand />
        </button>
        <nav className="app-nav" aria-label="App navigation">
          <button className={view === 'marketplace' ? 'active' : ''} onClick={() => onNavigate('marketplace')} type="button">
            Marketplace
          </button>
          <button className={view === 'portfolio' ? 'active' : ''} onClick={() => onNavigate('portfolio')} type="button">
            Portfolio
          </button>
          <button className={view === 'create' ? 'active' : ''} onClick={() => onNavigate('create')} type="button">
            Launch
          </button>
          <button className={view === 'docs' ? 'active' : ''} onClick={() => onNavigate('docs')} type="button">
            Docs
          </button>
        </nav>
        <div className="app-header-actions">
          <HeaderSocialLinks />
          {wallet.status === 'connected' && (
            <button type="button" className="header-handle" onClick={() => setShowHandle(true)}>
              {handle ?? '@ set handle'}
            </button>
          )}
          <button type="button" className="wallet-button" onClick={requestWallet} disabled={wallet.status === 'connecting'}>
            <Icon name="wallet" />
            {wallet.status === 'connected'
              ? shortenAddress(wallet.address)
              : wallet.status === 'connecting'
                ? 'Connecting'
                : wallet.status === 'missing'
                  ? 'Rabby not found'
                  : 'Connect Rabby'}
          </button>
        </div>
      </header>

      {(wallet.status === 'missing' || wallet.status === 'error') && (
        <div className="wallet-notice" role="status">
          {wallet.status === 'missing' ? (
            <>No injected wallet found. <a href="https://rabby.io/" target="_blank" rel="noreferrer">Install Rabby</a>.</>
          ) : wallet.message}
          <button type="button" onClick={() => setWallet({ status: 'idle' })} aria-label="Dismiss wallet notice"><Icon name="close" /></button>
        </div>
      )}

      <main className="app-main">
        {view === 'marketplace' && <MarketplacePage walletAddress={wallet.status === 'connected' ? wallet.address : undefined} onConnect={requestWallet} />}
        {view === 'portfolio' && <PortfolioPage walletAddress={wallet.status === 'connected' ? wallet.address : undefined} onConnect={requestWallet} />}
        {view === 'create' && <CreateAgentPage creatorHandle={handle ?? '@unclaimed'} walletAddress={wallet.status === 'connected' ? wallet.address : undefined} onConnect={requestWallet} />}
        {view === 'docs' && <DocsPage />}
      </main>

      <nav className="mobile-app-nav" aria-label="Mobile app navigation">
        <button type="button" className={view === 'marketplace' ? 'active' : ''} onClick={() => onNavigate('marketplace')}>Market</button>
        <button type="button" className={view === 'portfolio' ? 'active' : ''} onClick={() => onNavigate('portfolio')}>Portfolio</button>
        <button type="button" className={view === 'create' ? 'active' : ''} onClick={() => onNavigate('create')}>Launch</button>
        <button type="button" className={view === 'docs' ? 'active' : ''} onClick={() => onNavigate('docs')}>Docs</button>
      </nav>

      {showHandle && <HandleModal onSave={saveHandle} onSkip={() => setShowHandle(false)} />}
    </div>
  )
}
