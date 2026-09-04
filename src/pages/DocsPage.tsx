import type { ReactNode } from 'react'
import { pets } from '../data/pets'
import blueDocsPortrait from '../assets/docs-pets/blue.webp'
import sageDocsPortrait from '../assets/docs-pets/sage.webp'
import stoneDocsPortrait from '../assets/docs-pets/stone.webp'
import foxDocsPortrait from '../assets/docs-pets/fox-v2.webp'
import plumDocsPortrait from '../assets/docs-pets/plum-v2.webp'
import frogDocsPortrait from '../assets/docs-pets/frog-v2.webp'
import goldDocsPortrait from '../assets/docs-pets/gold-v2.webp'

const docsPetPortraits = [
  blueDocsPortrait,
  sageDocsPortrait,
  stoneDocsPortrait,
  foxDocsPortrait,
  plumDocsPortrait,
  frogDocsPortrait,
  goldDocsPortrait,
]

type DocsVisualKind = 'loop' | 'pets' | 'route' | 'vault' | 'policy' | 'keys' | 'steps'

interface DocsSection {
  number: string
  title: string
  body: string
  details?: string[]
  visual?: DocsVisualKind
}

const docsSections: DocsSection[] = [
  {
    number: '01',
    title: 'The product loop',
    body: 'LIQUIDMUPPETS is a Robinhood mainnet marketplace for policy-bounded onchain agents. A creator holding 100,000 $MUPPETS chooses a cosmetic pet, assigns a live task, deploys a single-asset vault and fungible Agent Key, then opens the first Key ask.',
    details: ['pet appearance has no financial effect', 'the task fixes the asset, adapter and risk caps', 'vault shares and Agent Keys remain separate'],
    visual: 'loop',
  },
  {
    number: '02',
    title: '$MUPPETS launch access',
    body: 'Every public page remains open. Launching a new agent through the app requires at least 100,000 $MUPPETS in the connected wallet. The API checks the canonical token balance on Robinhood Chain and the browser checks it again immediately before the first launch transaction.',
    details: [
      'the balance remains in the wallet and is not spent, locked or burned',
      'the canonical token address is still pending, so launch currently fails closed',
      'the deployed factory predates this access rule; direct contract calls are not token-gated until a gated factory migration',
    ],
  },
  {
    number: '03',
    title: 'Seven pets, three live tasks',
    body: 'Blue, sage, stone, fox, plum, frog and gold are appearance choices. Any pet can use stable yield, ETH range, or launch reserve. The pet never changes the money path or permissions.',
    visual: 'pets',
  },
  {
    number: '04',
    title: 'Where each task sends funds',
    body: 'Stable yield supplies USDG to one immutable Morpho market. ETH range sends WETH through EZManager into the canonical Uniswap WETH / USDG 0.01% pool. Launch pool currently stages WETH in an isolated reserve and does not enter a token pool.',
    details: ['stable: 90% maximum allocation and 10,000 USDG vault cap', 'range: 85% maximum allocation and 1 WETH vault cap', 'launch: 10% staging allocation and 0.25 WETH vault cap'],
    visual: 'route',
  },
  {
    number: '05',
    title: 'Stock Token and community markets',
    body: 'After choosing a task, the launch flow now shows its market universe. The current immutable route is marked live. Stock Token ranges, a company basket, and community-token pools are marked route review and cannot continue to launch until their own adapters and policies are deployed.',
    details: [
      'range candidates: NVDA, GME, SPCX and SPY Stock Tokens paired with USDG',
      'basket candidate: NVDA, MSFT and GOOGL with separate feed, weight and drift limits',
      'community candidates require contract identity, pool age, liquidity, volume, exit-depth and oracle review',
    ],
  },
  {
    number: '06',
    title: 'Vault shares and yield',
    body: 'Each StrategyVault is an ERC-4626 vault. Deposits mint transferable shares. Stable shares follow the USDG value returned by Morpho. Range shares follow the WETH value realized by the LP position. Launch-reserve shares remain WETH with no pool yield.',
    details: ['Morpho interest is variable and can be zero', 'concentrated liquidity can underperform holding WETH', 'a full redemption recalls the complete adapter position before paying the realized assets'],
    visual: 'vault',
  },
  {
    number: '07',
    title: 'The backend algorithm',
    body: 'The creator signs each allocation from the app. PolicyExecutor applies the task cap, daily cap, cooldown and expiry. Stable yield then checks Morpho health. ETH range opens a fixed-width position through EZManager. Launch reserve only isolates WETH.',
    details: ['Morpho supply must remain at least 10,000,000 USDG and utilization at or below 95%', 'range recenter closes and reopens atomically, so it cannot stop halfway', 'no deployer or keeper key is stored in the browser or public API'],
    visual: 'policy',
  },
  {
    number: '08',
    title: 'The onchain leash',
    body: 'PolicyExecutor is the final authority. It checks creator or keeper authorization, pause state, expiry, cooldown, per-action cap, daily cap and total allocation cap before StrategyVault can move assets into its fixed adapter. The creator can allocate, recall all, or atomically recenter an ETH range, but cannot replace the route.',
  },
  {
    number: '09',
    title: 'Agent Keys and their market',
    body: 'Each Muppet has a fixed-supply, zero-decimal ERC-20 Agent Key. The creator receives the supply and chooses the first ask. The actual floor is always the cheapest active ask. The native marketplace supports partial asks, bids, buys and sells and charges 3% only when a trade fills.',
    details: ['Key ownership is not vault ownership', 'Key price does not change vault share price', 'current utility is trading and permanent onchain binding'],
    visual: 'keys',
  },
  {
    number: '10',
    title: 'Binding a Key',
    body: 'A holder can permanently bind whole Keys to their wallet. Binding burns the transferable units and records the bound balance in the Key contract. It does not mint an NFT and cannot claim vault assets.',
  },
  {
    number: '11',
    title: 'How to use the live loop',
    body: 'Connect an EVM wallet on Robinhood Chain mainnet and hold 100,000 $MUPPETS to unlock launch. Choose any pet and task, then select that task\'s live market. Set a Key supply and first floor, then deposit the task asset. The creator runs the bounded cycle. Anyone can inspect, buy, list, bid, sell or bind a Key. Portfolio reads balances from chain.',
    visual: 'steps',
  },
  {
    number: '12',
    title: 'Public activity and handles',
    body: 'The marketplace tape decodes launches, listings, fills, deposits, withdrawals, allocations, recalls and Key binding from mainnet logs. A wallet can sign an app-handle claim with no gas. If no handle is claimed, the tape shows the shortened wallet instead.',
    details: ['green values mark buys, deposits, launches and allocations', 'red values mark sells, withdrawals and recalls', 'asks and bids are neutral until they fill', 'an app handle proves wallet control, not ownership of an external social account'],
  },
  {
    number: '13',
    title: 'Current boundary',
    body: 'The mainnet contracts use real USDG, WETH, Morpho, Uniswap and EZManager. Local and fork tests cover the adapters, full redemption and atomic recentering, but the contracts are not independently audited. Caps limit exposure and do not remove protocol, oracle, liquidity, LP or stablecoin risk.',
    details: [
      'factory · 0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460',
      'policy · 0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc',
      'Key market · 0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb',
      'Morpho adapter · 0x169EfD23f67811709C0Db823f7c82fcF2732781d',
      'range adapter · 0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d',
      'launch reserve · 0x956127B0B586B9427182FCd9325efe032E9B5181',
      'deployment block 52653314',
    ],
  },
]

function VisualFrame({ title, status, children, className = '' }: { title: string; status: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`docs-visual ${className}`.trim()}>
      <figcaption>
        <span>{title}</span>
        <i aria-hidden="true" />
        <strong>{status}</strong>
      </figcaption>
      {children}
    </figure>
  )
}

function ProductLoopVisual() {
  return (
    <VisualFrame title="IN APP / LAUNCH" status="MAINNET 4663" className="docs-loop-visual">
      <div className="docs-loop-pet">
        <img src={docsPetPortraits[0]} alt="Blue pet appearance" loading="lazy" />
        <span><small>appearance</small><strong>blue</strong></span>
      </div>
      <ol className="docs-loop-track">
        <li><span>01</span><strong>choose pet</strong></li>
        <li><span>02</span><strong>task + market</strong></li>
        <li><span>03</span><strong>deploy vault</strong></li>
        <li><span>04</span><strong>open Key floor</strong></li>
      </ol>
    </VisualFrame>
  )
}

function PetAppearanceVisual() {
  return (
    <VisualFrame title="APPEARANCE PICKER" status="7 AVAILABLE" className="docs-pets-visual">
      <div className="docs-pet-grid">
        {pets.map((pet, index) => (
          <div className="docs-pet-card" key={pet.id}>
            <img src={docsPetPortraits[index]} alt={`${pet.name} pet appearance`} loading="lazy" />
            <span>
              <small>{String(index + 1).padStart(2, '0')}</small>
              <strong>{pet.name}</strong>
            </span>
          </div>
        ))}
      </div>
      <p className="docs-visual-note">appearance only · the selected task controls the money path</p>
    </VisualFrame>
  )
}

function MoneyRouteVisual() {
  return (
    <VisualFrame title="LIVE MONEY PATHS" status="3 SELECTABLE" className="docs-route-visual">
      <div className="docs-task-route-grid">
        <div className="docs-task-route active">
          <img src={docsPetPortraits[5]} alt="Frog stable-yield example" loading="lazy" />
          <span><small>stable yield</small><strong>USDG → mUSDG</strong><b>90% Morpho · 10% idle</b></span>
        </div>
        <div className="docs-task-route active">
          <img src={docsPetPortraits[3]} alt="Fox ETH-range example" loading="lazy" />
          <span><small>ETH range</small><strong>WETH → mETH</strong><b>85% EZManager · 15% idle</b></span>
        </div>
        <div className="docs-task-route reserve">
          <img src={docsPetPortraits[1]} alt="Sage launch-reserve example" loading="lazy" />
          <span><small>launch pool</small><strong>WETH → mLAUNCH</strong><b>10% staged · no pool yet</b></span>
        </div>
      </div>
    </VisualFrame>
  )
}

function VaultShareVisual() {
  return (
    <VisualFrame title="VAULT RECEIPT" status="ERC-4626" className="docs-vault-visual">
      <div className="docs-vault-equation">
        <div><span>user deposits</span><strong>USDG</strong><small>underlying asset</small></div>
        <b>→</b>
        <div className="accent"><span>vault mints</span><strong>mUSDG</strong><small>transferable shares</small></div>
      </div>
      <div className="docs-vault-rule">
        <span>share value</span>
        <strong>total vault assets ÷ total shares</strong>
        <small>borrower interest may increase assets · APY can be zero</small>
      </div>
    </VisualFrame>
  )
}

function PolicyVisual() {
  const checks = ['authorized signer', 'cooldown ready', 'within daily cap', 'market healthy']

  return (
    <VisualFrame title="TRANSACTION CHECK" status="ONCHAIN POLICY" className="docs-policy-visual">
      <div className="docs-policy-command">
        <img src={docsPetPortraits[1]} alt="Sage pet appearance" loading="lazy" />
        <span><small>requested action</small><strong>allocate USDG</strong></span>
      </div>
      <div className="docs-policy-checks">
        {checks.map((check) => <span key={check}><i>✓</i>{check}</span>)}
      </div>
      <div className="docs-policy-result"><span>PolicyExecutor</span><strong>route approved</strong></div>
    </VisualFrame>
  )
}

function KeyMarketVisual() {
  return (
    <VisualFrame title="KEY MARKET" status="NATIVE LISTING" className="docs-keys-visual">
      <div className="docs-key-agent">
        <img src={docsPetPortraits[3]} alt="Fox pet appearance" loading="lazy" />
        <span><small>agent appearance</small><strong>fox</strong><em>stable yield</em></span>
      </div>
      <div className="docs-key-book">
        <div><span>floor</span><strong>lowest active ask</strong></div>
        <div><span>supply</span><strong>fixed at launch</strong></div>
        <div><span>market fee</span><strong>3% when filled</strong></div>
      </div>
      <div className="docs-key-actions"><span>buy</span><span>list</span><span>bid</span><span>sell</span><span>bind</span></div>
    </VisualFrame>
  )
}

function LiveStepsVisual() {
  const steps = [
    ['01', 'launch', 'pet + task + market'],
    ['02', 'fund', 'USDG or WETH'],
    ['03', 'run', 'policy checked'],
    ['04', 'track', 'live chain reads'],
  ]

  return (
    <VisualFrame title="LIVE LOOP" status="NO DEMO DATA" className="docs-steps-visual">
      <div className="docs-step-screens">
        {steps.map(([number, title, note]) => (
          <div key={number}>
            <span>{number}</span>
            <strong>{title}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
    </VisualFrame>
  )
}

function DocsVisual({ kind }: { kind: DocsVisualKind }) {
  if (kind === 'loop') return <ProductLoopVisual />
  if (kind === 'pets') return <PetAppearanceVisual />
  if (kind === 'route') return <MoneyRouteVisual />
  if (kind === 'vault') return <VaultShareVisual />
  if (kind === 'policy') return <PolicyVisual />
  if (kind === 'keys') return <KeyMarketVisual />
  return <LiveStepsVisual />
}

export function DocsPage() {
  return (
    <div className="app-page docs-page">
      <header className="docs-heading">
        <p>LIQUIDMUPPETS / DOCUMENTATION</p>
        <h1>Everything about LIQUIDMUPPETS.</h1>
        <span>The money path, $MUPPETS launch gate, Key market, keeper decisions and onchain limits.</span>
      </header>

      <div className="docs-layout">
        <aside aria-label="Documentation sections">
          {docsSections.map((section) => (
            <a href={`#docs-${section.number}`} key={section.number}>
              <span>{section.number}</span>
              {section.title}
            </a>
          ))}
        </aside>

        <article>
          {docsSections.map((section) => (
            <section id={`docs-${section.number}`} key={section.number}>
              <span>{section.number}</span>
              <div className="docs-section-copy">
                <h2>{section.title}</h2>
                <p>{section.body}</p>
                {section.details && <ul>{section.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
                {section.visual && <DocsVisual kind={section.visual} />}
              </div>
            </section>
          ))}
          <footer>
            <strong>Read this before funding</strong>
            <p>This is live mainnet software using real assets. APY is not promised. Morpho withdrawals depend on market liquidity, ranges can lose against holding WETH, and launch reserve earns nothing until a reviewed pool route exists. The owner is a dedicated deployment wallet rather than a multisig. Use small amounts until the contracts receive independent review.</p>
          </footer>
        </article>
      </div>
    </div>
  )
}
