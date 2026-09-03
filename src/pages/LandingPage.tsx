import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { View } from '../types'
import { pets } from '../data/pets'
import { Brand } from '../components/Brand'
import { DarkNoiseField } from '../components/DarkNoiseField'
import { HeaderSocialLinks } from '../components/HeaderSocialLinks'
import { Icon } from '../components/Icon'
import { PixelAgents } from '../components/PixelAgents'
import heroWorld2k from '../assets/muppets-lucid-meadow-hero-v3-2k.webp'
import heroWorld4k from '../assets/muppets-lucid-meadow-hero-v3-4k.webp'

interface LandingPageProps {
  onNavigate: (view: View) => void
}

const storySteps = [
  { number: '01', title: 'Choose the pet', text: 'Pick one of seven appearances. It changes nothing financial.' },
  { number: '02', title: 'Choose the task', text: 'Stable yield, ETH range, or approved launch liquidity.' },
  { number: '03', title: 'Fund the vault', text: 'Deposit one asset and receive a separate ERC-4626 share.' },
  { number: '04', title: 'Open the Key market', text: 'Set the first real ask and let listings establish the floor.' },
]

const agentTypes = [
  { icon: 'receipt' as const, label: 'Stable yield', text: 'USDG deposits mint mUSDG shares. The keeper can allocate only to the configured lending route.' },
  { icon: 'layers' as const, label: 'ETH range', text: 'WETH deposits mint mETH shares. A bounded policy opens a real EZManager WETH/USDG range.' },
  { icon: 'spark' as const, label: 'Launch pool', text: 'WETH can stage in a 10% launch reserve. It stays in WETH until a token-pool route is reviewed.' },
]

export function LandingPage({ onNavigate }: LandingPageProps) {
  const [storyProgress, setStoryProgress] = useState(0)
  const [rolesProgress, setRolesProgress] = useState(0)
  const [activeStep, setActiveStep] = useState(0)
  const [entered, setEntered] = useState(false)
  const [darkHeader, setDarkHeader] = useState(false)
  const storyRef = useRef<HTMLElement>(null)
  const rolesRef = useRef<HTMLElement>(null)
  const heroScrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('motion-ready')
    const entryTimer = window.setTimeout(() => setEntered(true), 140)
    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-visible')
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    targets.forEach((target) => observer.observe(target))

    let frame = 0
    const updateMotion = () => {
      frame = 0
      const story = storyRef.current
      if (story) {
        const rect = story.getBoundingClientRect()
        const travel = Math.max(1, rect.height - window.innerHeight * 0.72)
        const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.12 - rect.top) / travel))
        setStoryProgress(progress)
        setActiveStep(Math.min(storySteps.length - 1, Math.floor(progress * storySteps.length)))
      }

      const roles = rolesRef.current
      if (roles) {
        const rect = roles.getBoundingClientRect()
        const travel = Math.max(1, rect.height - window.innerHeight * 0.72)
        const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.12 - rect.top) / travel))
        setRolesProgress(progress)
      }

      const heroScroll = heroScrollRef.current
      const hero = heroScroll?.querySelector<HTMLElement>('.hero')
      if (heroScroll && hero) {
        const rect = heroScroll.getBoundingClientRect()
        const travel = Math.max(1, rect.height - window.innerHeight)
        const progress = Math.min(1, Math.max(0, -rect.top / travel))
        const exit = Math.min(1, Math.max(0, (progress - 0.12) / 0.72))
        hero.style.setProperty('--hero-shift', `${Math.round(exit * -170)}px`)
        hero.style.setProperty('--hero-scale', `${1 - exit * 0.055}`)
        hero.style.setProperty('--hero-opacity', `${Math.max(0, 1 - exit * 1.08)}`)
        hero.style.setProperty('--hero-blur', `${exit * 3.5}px`)
        setDarkHeader(progress >= 0.78)
      }
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(updateMotion)
    }
    updateMotion()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      observer.disconnect()
      window.clearTimeout(entryTimer)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
      document.documentElement.classList.remove('motion-ready')
    }
  }, [])

  const storyStyle = useMemo(
    () => ({ '--story-progress': storyProgress } as CSSProperties),
    [storyProgress],
  )
  const storyPhase = storyProgress * storySteps.length
  const rolesStyle = useMemo(
    () => ({
      '--roles-progress': rolesProgress,
      '--roles-progress-x': `${0.7 + rolesProgress * 98.6}%`,
    } as CSSProperties),
    [rolesProgress],
  )
  const rolesPhase = rolesProgress * (agentTypes.length + 0.8)

  return (
    <div className={`landing-page landing-v2 landing-v3${entered ? ' is-entered' : ''}${darkHeader ? ' is-light-phase' : ''}`}>
      <header className={`landing-header${darkHeader ? ' header-dark' : ''}`}>
        <button type="button" className="brand-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Brand />
        </button>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#about">About</a>
          <a href="#agents">Muppets</a>
          <a href="#safety">Safety</a>
          <a href="/docs" onClick={(event) => { event.preventDefault(); onNavigate('docs') }}>Docs</a>
        </nav>
        <div className="landing-header-actions">
          <HeaderSocialLinks />
          <button type="button" className="button button-dark header-cta" onClick={() => onNavigate('marketplace')}>
            Open key market <Icon name="arrow" />
          </button>
        </div>
      </header>

      <main>
        <section ref={heroScrollRef} className="hero-scroll" id="product">
          <div className="hero">
            <picture className="hero-world-art" aria-hidden="true">
              <source
                type="image/webp"
                srcSet={`${heroWorld2k} 1920w, ${heroWorld4k} 3840w`}
                sizes="100vw"
              />
              <img
                src={heroWorld2k}
                srcSet={`${heroWorld2k} 1920w, ${heroWorld4k} 3840w`}
                sizes="100vw"
                alt=""
                decoding="sync"
                fetchPriority="high"
              />
            </picture>
            <div className="hero-world-overlay" aria-hidden="true" />
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-orbit hero-orbit-one" aria-hidden="true" />
            <div className="hero-orbit hero-orbit-two" aria-hidden="true" />
            <PixelAgents />
            <div className="hero-copy">
              <h1>
                <span>One Muppet.</span>
                <span>One onchain play.</span>
              </h1>
              <p>Choose a pet, assign one pool task, deposit into its vault, and trade its separate Agent Key.</p>
              <div className="hero-actions">
                <button type="button" className="button button-dark" onClick={() => onNavigate('create')}>
                  Launch a Muppet <Icon name="arrow" />
                </button>
                <button type="button" className="button button-ghost" onClick={() => onNavigate('marketplace')}>
                  Explore key markets
                </button>
              </div>
            </div>
            <div className="hero-scroll-cue" aria-hidden="true">
              <span>scroll</span>
              <i><Icon name="chevron" /></i>
            </div>
          </div>
        </section>

        <div className="dark-landing light-landing" id="about">
          <DarkNoiseField />
          <div className="dark-ambient dark-ambient-one" aria-hidden="true" />
          <div className="dark-ambient dark-ambient-two" aria-hidden="true" />

          <section className="intro-section section-shell" data-chapter="01 / CONTROL" data-reveal>
            <h2>The pet is the face. The task moves the money.</h2>
            <p className="section-lead">LIQUIDMUPPETS keeps appearance, vault ownership, strategy execution, and Agent Key demand as four separate things.</p>
            <div className="fact-row">
              <div><strong>07</strong><span>cosmetic pet choices</span></div>
              <div><strong>03</strong><span>bounded task templates</span></div>
              <div><strong>02</strong><span>separate fungible tokens</span></div>
            </div>
          </section>

          <section ref={storyRef} className="story-section story-book-section section-shell" data-chapter="02 / FIELD BOOK" style={storyStyle}>
          <div className="story-book-sticky">
            <div className="story-heading" data-reveal>
              <h2>Four leaves. One visible system.</h2>
            </div>

            <div className="operator-folio" data-reveal>
              <aside className="folio-index" aria-label="Agent deployment chapters">
                <div className="folio-index-head">
                  <span>LIQUIDMUPPETS / 001</span>
                  <span>04 LEAVES</span>
                </div>
                <ol>
                  {storySteps.map((step, index) => (
                    <li
                      className={`${activeStep === index ? 'is-active' : ''}${index < activeStep ? ' is-past' : ''}`}
                      key={step.number}
                      aria-current={activeStep === index ? 'step' : undefined}
                    >
                      <span>{step.number}</span>
                      <strong>{step.title}</strong>
                    </li>
                  ))}
                </ol>
                <div className="folio-index-foot">
                  <span>scroll to turn</span>
                  <i aria-hidden="true"><Icon name="chevron" /></i>
                </div>
              </aside>

              <div className="folio-book">
                <span className="folio-spine" aria-hidden="true" />
                <div className="folio-page-stack">
                  {storySteps.map((step, index) => {
                    const arrival = index === 0 ? 1 : Math.min(1, Math.max(0, (storyPhase - index + 0.12) / 0.38))
                    const departure = index === storySteps.length - 1
                      ? 0
                      : Math.min(1, Math.max(0, (storyPhase - index - 0.78) / 0.38))
                    const opacity = Math.max(0, arrival * (1 - departure))
                    const rotate = (1 - arrival) * 7 - departure * 17
                    const translateX = departure * -8
                    const translateY = (1 - arrival) * 34 - departure * 10
                    const scale = 0.985 + arrival * 0.015 - departure * 0.018
                    const blur = (1 - arrival) * 9 + departure * 4

                    return (
                      <article
                        className={`folio-page folio-page-${index + 1}${activeStep === index ? ' is-active' : ''}${index < activeStep ? ' is-past' : ''}`}
                        key={step.number}
                        style={{
                          zIndex: storySteps.length - index,
                          opacity,
                          filter: `blur(${blur}px)`,
                          transform: `perspective(1500px) translate3d(${translateX}%, ${translateY}px, 0) rotateY(${rotate}deg) scale(${scale})`,
                        }}
                      >
                        <div className="folio-page-head">
                          <span>OPERATOR LEAF / {step.number}</span>
                          <span>{String(index + 1).padStart(2, '0')} / 04</span>
                        </div>
                        <div className={`folio-glyph folio-glyph-${index + 1}`} aria-hidden="true">
                          <span /><span /><span /><span />
                          <i /><b />
                        </div>
                        <div className="folio-page-copy">
                          <span className="folio-page-number">{step.number}</span>
                          <div>
                            <h3>{step.title}</h3>
                            <p>{step.text}</p>
                          </div>
                        </div>
                        <div className="folio-page-foot">
                          <span>{['mandate', 'guardrails', 'execution', 'market'][index]}</span>
                          <span>PUBLIC BY DESIGN</span>
                        </div>
                      </article>
                    )
                  })}
                </div>
                <div className="folio-progress" aria-hidden="true"><span /></div>
              </div>
            </div>
          </div>
          </section>

          <section ref={rolesRef} className="agent-types strategy-roles section-shell" id="agents" data-chapter="03 / ROLES" style={rolesStyle}>
          <div className="roles-sticky">
            <div className="section-heading-row" data-reveal>
              <div>
                <h2>Assign one exact job.</h2>
              </div>
              <p>The backend scores routes. The onchain policy decides whether the transaction is allowed.</p>
            </div>
            <div className="type-grid">
              <div className="strategy-rail" aria-hidden="true"><span /><i /></div>
              {agentTypes.map((type, index) => {
                const reveal = Math.min(1, Math.max(0, rolesPhase - index * 0.92))
                const roleStyle = {
                  '--role-reveal': reveal,
                  '--role-opacity': 0.14 + reveal * 0.86,
                  '--role-shift': `${(1 - reveal) * 24}px`,
                  '--role-scale': 0.965 + reveal * 0.035,
                  '--role-clip': `${(1 - reveal) * 44}%`,
                  '--role-blur': `${(1 - reveal) * 7}px`,
                } as CSSProperties

                return (
                  <article key={type.label} style={roleStyle}>
                    <span className="type-icon"><Icon name={type.icon} /></span>
                    <span className="type-number">0{index + 1}</span>
                    <h3>{type.label}</h3>
                    <p>{type.text}</p>
                  </article>
                )
              })}
            </div>
          </div>
          </section>

          <section className="policy-section section-shell" id="safety" data-chapter="04 / POLICY">
          <div className="policy-copy" data-reveal>
            <h2>The algorithm cannot invent a route.</h2>
            <p>Assets, adapters, allocation, cooldown, daily spend, expiry, pause, and recall are enforced onchain.</p>
            <ul>
              <li><Icon name="check" /> User keeps the vault shares</li>
              <li><Icon name="check" /> Agent gets only approved calls</li>
              <li><Icon name="check" /> Failed limits become public events</li>
            </ul>
          </div>
          <div className="policy-panel" data-reveal>
            <div className="panel-head">
              <span><i /> POLICY / RANGE-07</span>
              <span className="policy-live">active</span>
            </div>
            <div className="policy-agent">
              <img src={pets[0].portrait} alt="" />
              <div><strong>stable yield template</strong><small>mUSDG vault</small></div>
              <Icon name="shield" />
            </div>
            <div className="policy-rows">
              <div><span>adapter</span><strong>Morpho c845…cddd6</strong><em>immutable</em></div>
              <div><span>single action</span><strong>90% of vault max</strong><em>hard cap</em></div>
              <div><span>daily allocation</span><strong>90% of vault max</strong><em>rolling cap</em></div>
              <div><span>cooldown</span><strong>30 minutes</strong><em>hard gate</em></div>
              <div><span>expiry</span><strong>90 days</strong><em>renew explicitly</em></div>
            </div>
            <div className="policy-actions">
              <button type="button"><Icon name="pause" /> Pause</button>
              <button type="button" className="danger"><Icon name="lock" /> Revoke</button>
            </div>
          </div>
          </section>

          <section className="activity-section section-shell" data-chapter="05 / RECEIPTS">
          <div className="section-heading-row" data-reveal>
            <div>
            <h2>Every state change becomes a receipt.</h2>
            </div>
            <p>The mainnet app links the factory, vault, Key, listing, deposit, Morpho allocation, and redemption transactions.</p>
          </div>
          <div className="activity-table" data-reveal>
            <div className="activity-head"><span>action</span><span>venue</span><span>amount</span><span>policy</span><span>status</span><span>receipt</span></div>
            {[
              ['deposit', 'strategy vault', 'underlying asset', 'ERC-4626 accounting', 'wallet signed', 'vault event'],
              ['allocate', 'Morpho Blue', 'idle USDG', 'policy + market checked', 'creator signed', 'Morpho event'],
              ['accrue', 'Morpho Blue', 'borrow interest', 'market rate', 'onchain', 'market state'],
              ['redeem', 'strategy vault', 'vault shares', 'instant recall', 'wallet signed', 'withdraw event'],
            ].map((row) => (
              <div className="activity-row" key={row[0]}>
                <strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><span>{row[3]}</span>
                <span className={`activity-status activity-${row[4]}`}>{row[4]}</span><a href="#safety">{row[5]} <Icon name="arrow" /></a>
              </div>
            ))}
          </div>
          </section>

          <section className="market-preview section-shell" data-chapter="06 / MARKET">
          <div className="section-heading-row" data-reveal>
            <div>
              <h2>The keys are the marketplace.</h2>
            </div>
            <div className="market-heading-action">
              <span>Floor, top bid, volume, sales, holders and supply come from the native key market.</span>
              <button type="button" className="button button-ghost" onClick={() => onNavigate('marketplace')}>Open marketplace <Icon name="arrow" /></button>
            </div>
          </div>
          <div className="market-card-row pet-preview-row" data-reveal>
            {pets.map((pet) => <button type="button" className="landing-pet-card" key={pet.id} onClick={() => onNavigate('create')}><img src={pet.portrait} alt={`${pet.name} pet`} /><span>{pet.name}</span></button>)}
          </div>
          </section>

          <section className="final-cta section-shell" data-chapter="07 / DEPLOY" data-reveal>
          <div className="final-orbit" aria-hidden="true" />
          <h2>Launch the play, then earn the market.</h2>
          <p>Deploy one strategy vault, one permission policy and one fungible Agent Key market.</p>
          <button type="button" className="button button-dark" onClick={() => onNavigate('create')}>
            Launch a Muppet <Icon name="arrow" />
          </button>
          <small>Wallet approval required for every deployment.</small>
          </section>
        </div>
      </main>

      <footer className="landing-footer">
        <div><Brand /><p>An interface for permissioned onchain agents.</p></div>
        <div><span>PRODUCT</span><a href="#product">How it works</a><button onClick={() => onNavigate('marketplace')}>Key market</button><button onClick={() => onNavigate('create')}>Launch</button></div>
        <div><span>READ</span><a href="/docs" onClick={(event) => { event.preventDefault(); onNavigate('docs') }}>LIQUIDMUPPETS docs</a><a href="https://x.com/AMBF" target="_blank" rel="noreferrer">X / @AMBF</a><a href="https://docs.morpho.org/" target="_blank" rel="noreferrer">Morpho</a></div>
        <div className="footer-note">Experimental Robinhood Chain mainnet software. Real assets, variable yield, unaudited contracts, 10,000 USDG cap per vault.</div>
      </footer>
    </div>
  )
}
