import { useState } from 'react'
import type { View } from '../types'
import { Brand } from '../components/Brand'
import { HeaderSocialLinks } from '../components/HeaderSocialLinks'
import { Icon } from '../components/Icon'
import { LandingSoundControl } from '../components/LandingSoundControl'
import { PixelAgents } from '../components/PixelAgents'
import heroWorld2k from '../assets/muppets-lucid-meadow-hero-v3-2k.webp'
import heroWorld4k from '../assets/muppets-lucid-meadow-hero-v3-4k.webp'

interface HomePageProps {
  onNavigate: (view: View) => void
}

const MUPPETS_CA = '0x5e7516be1be5d4396b060908cd44c9db093c4189'

const productObjects = [
  {
    label: '$MUPPETS',
    text: 'Unlocks creator slots. No claim on vault assets or yield.',
  },
  {
    label: 'Vault shares',
    text: 'Represent the assets deposited into one Muppet vault.',
  },
  {
    label: 'Agent Key',
    text: 'A separate speculative market. No claim on vault assets or yield.',
  },
] as const

export function HomePage({ onNavigate }: HomePageProps) {
  const [copied, setCopied] = useState(false)

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(MUPPETS_CA)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="simple-home">
      <header className="simple-home-header">
        <button type="button" className="brand-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Brand />
        </button>
        <nav className="simple-home-nav" aria-label="Main navigation">
          <button type="button" onClick={() => onNavigate('about')}>About</button>
          <button type="button" onClick={() => onNavigate('marketplace')}>Marketplace</button>
          <button type="button" onClick={() => onNavigate('docs')}>Docs</button>
        </nav>
        <div className="simple-home-header-actions">
          <HeaderSocialLinks />
          <button type="button" className="simple-home-header-cta" onClick={() => onNavigate('create')}>
            Create my Muppet <Icon name="arrow" />
          </button>
        </div>
      </header>

      <LandingSoundControl />

      <main className="simple-home-hero">
        <picture className="simple-home-art" aria-hidden="true">
          <source type="image/webp" srcSet={`${heroWorld2k} 1920w, ${heroWorld4k} 3840w`} sizes="100vw" />
          <img
            src={heroWorld2k}
            srcSet={`${heroWorld2k} 1920w, ${heroWorld4k} 3840w`}
            sizes="100vw"
            alt=""
            decoding="sync"
            fetchPriority="high"
          />
        </picture>
        <div className="simple-home-overlay" aria-hidden="true" />
        <div className="simple-home-grid" aria-hidden="true" />

        <div className="simple-home-stage">
          <PixelAgents />
        </div>

        <section className="simple-home-copy" aria-labelledby="simple-home-title">
          <h1 id="simple-home-title">A Muppet is an onchain vault with one job.</h1>
          <p>Pick a pet, choose a strategy, and fund it with USDG or WETH. The Muppet can only move funds through the route and limits you approve. Every action is public.</p>
          <div className="simple-home-actions">
            <button type="button" className="simple-home-primary" onClick={() => onNavigate('create')}>
              Create my Muppet <Icon name="arrow" />
            </button>
            <a className="simple-home-secondary" href="/app/muppet/0">See one working</a>
          </div>
          <button type="button" className="simple-home-portfolio" onClick={() => onNavigate('portfolio')}>
            Already have Muppets? <span>Open portfolio</span>
          </button>
          <strong className="simple-home-slot-note">Hold 15,000 $MUPPETS to unlock one creator slot. The tokens stay in your wallet.</strong>
          <div className="simple-home-ca">
            <span>CA</span>
            <code>{MUPPETS_CA}</code>
            <button type="button" onClick={copyAddress} aria-label="Copy MUPPETS contract address">
              <Icon name={copied ? 'check' : 'receipt'} />
              <span aria-live="polite">{copied ? 'copied' : 'copy'}</span>
            </button>
          </div>
        </section>

        <section className="simple-home-objects" aria-label="The three separate LiquidMuppets assets">
          {productObjects.map((item) => (
            <article key={item.label}>
              <strong>{item.label}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
