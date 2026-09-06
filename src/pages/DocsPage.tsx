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

type DocsVisualKind = 'loop' | 'pets' | 'route' | 'rwa' | 'vault' | 'policy' | 'keys' | 'steps'

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
    body: 'LIQUIDMUPPETS is a Robinhood mainnet marketplace for policy-bounded onchain agents. A creator holding 15,000 $MUPPETS chooses a cosmetic pet, assigns a live task, deploys a single-asset vault and fungible Agent Key, then opens the first Key ask.',
    details: ['pet appearance has no financial effect', 'the task fixes the asset, adapter and risk caps', 'vault shares and Agent Keys remain separate'],
    visual: 'loop',
  },
  {
    number: '02',
    title: '$MUPPETS launch access',
    body: 'Every public page remains open. Launching a new agent through the app requires at least 15,000 $MUPPETS in the connected wallet. The API checks the canonical token balance on Robinhood Chain and the browser checks it again immediately before the first launch transaction.',
    details: [
      'the balance remains in the wallet and is not spent, locked or burned',
      'canonical token · 0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189',
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
    title: 'Marketplace fee reserve',
    body: 'Every settled Key trade sends the 3% marketplace fee directly to FeeRwaReserve. At 0.0001 ETH, the private keeper can convert native ETH to USDG and buy the next eligible Robinhood Stock Token. The contract rotates across 26 enabled routes and caps each cycle at 0.01 ETH.',
    details: [
      'the first 0.01 ETH bootstrap bought 0.076456289003050387 AAPL Stock Token',
      'each route requires live USDG pool liquidity, a fresh Chainlink price, and oraclePaused() = false',
      'AAPL, AMD, AMZN, ASML, BABA, CRCL, DELL, GME, GOOGL, INTC, META, MSFT, MSTR, MU, NVDA, PLTR, QQQ, SGOV, SLV, SNDK, SPCX, SPY, TSLA, TSM, USAR and USO are enabled',
      'Stock Tokens are tokenized debt securities and do not grant shareholder rights in the underlying company',
    ],
    visual: 'rwa',
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
    body: 'Creators can still sign their own actions. The private A5 keeper is active on a five minute schedule for bounded strategy allocations and fee-reserve purchases. It records every decision, but signs only when the onchain policy and route checks produce an executable action. Public keeper triggering stays disabled.',
    details: ['Morpho supply must remain at least 10,000,000 USDG and utilization at or below 95%', 'range recenter closes and reopens atomically, so it cannot stop halfway', 'the keeper key stays host-encrypted and never enters the browser or public API'],
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
    body: 'Each Muppet has a fixed-supply, zero-decimal ERC-20 Agent Key. The creator receives the supply and chooses the first ask. The actual floor is always the cheapest active ask. The native marketplace supports partial asks, bids, buys and sells. Its 3% fill fee goes to the Stock Token reserve.',
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
    body: 'Connect an EVM wallet on Robinhood Chain mainnet. New launches unlock when the connected wallet holds 15,000 $MUPPETS. Confirm vault and Key creation, Key approval, and the first ask. The post-launch command center then previews vault shares, funds the vault, shows keeper timing, and links to the public record and X sharing.',
    details: [
      'each submitted launch receipt is saved in this browser so Resume launch can continue at the first unfinished stage',
      'recovery is scoped to this wallet, chain and factory and stores public transaction metadata only',
      'expected shares come from the deployed ERC-4626 previewDeposit call before funding',
      'the next keeper time is an estimate; policy can still act or hold',
    ],
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
    title: 'Public Muppet performance',
    body: 'Every Muppet has a shareable /app/muppet/{id} page. The marketplace also places its recorded change, deployed percentage, health, oracle boundary and latest keeper decision in one performance table. Select any two Muppets to compare their evidence side by side without converting assets or equalizing different tracking periods.',
    details: [
      'five minute checkpoints record share price, NAV, deployed and idle capital, deposits and withdrawals',
      'cash-flow-adjusted change removes recorded deposits and adds recorded withdrawals before comparing with opening NAV',
      'tracking starts with the first recorded checkpoint; no earlier curve or historical APY is invented',
      'comparison keeps each Muppet in its native asset and displays both tracking starts explicitly',
      'when an oracle interface has no update timestamp, the page says timestamp not exposed instead of calling it fresh',
      'deposits, withdrawals, allocations and recalls link to their transaction receipts',
      'the Agent Key market stays in a separate section because Keys do not own vault assets',
    ],
  },
  {
    number: '14',
    title: 'Public creator profiles',
    body: 'Every creator wallet has a shareable /app/creator/{wallet} page. It groups all Muppets launched by that wallet, their recorded vault evidence and transaction receipts. Combined capital remains grouped by native asset, so USDG and WETH are never added into one number.',
    details: [
      'a wallet-signed app handle appears when one has been claimed; otherwise the exact wallet remains the identity',
      'each Muppet links to its own performance page and keeps its original tracking start',
      'Agent Key markets sit below a separate speculative-market boundary and never enter vault totals',
      'new history begins with recorded checkpoints; no earlier APY or performance is invented',
    ],
  },
  {
    number: '15',
    title: 'System Pulse',
    body: 'System Pulse combines decoded transaction events and recorded keeper decisions into one reverse-chronological public feed. It covers launches, deposits, withdrawals, allocations, recalls, range changes, Key orders and fills, bindings, keeper actions and holds, and Stock Token reserve purchases.',
    details: [
      'chain events link to the exact transaction receipt and block',
      'keeper actions inherit the recorded policy reason when a matching receipt exists',
      'keeper holds are visible with their reason and say that no transaction was signed',
      'vault, range, keeper, Agent Key and Stock Token records can be filtered without mixing their economics',
      'a creator profile uses the same feed filtered to Muppets launched by that wallet',
    ],
  },
  {
    number: '16',
    title: 'Current boundary',
    body: 'The mainnet contracts use real USDG, WETH, Morpho, Uniswap and EZManager. Local and fork tests cover the adapters, full redemption and atomic recentering, but the contracts are not independently audited. Caps limit exposure and do not remove protocol, oracle, liquidity, LP or stablecoin risk.',
    details: [
      'factory · 0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460',
      'policy · 0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc',
      'Key market · 0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb',
      'fee RWA reserve · 0xF10DA007314bB3e7B34FE06bB5c590190dcE9765',
      '$MUPPETS · 0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189',
      'keeper · 0xA5960A69E57F4EbC924503bC829f1E6670BfBA51',
      'the owner can pause the fee reserve and rescue held assets while it is paused',
      'Stock Token availability and restrictions depend on jurisdiction; the app does not determine legal eligibility',
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

function RwaReserveVisual() {
  const routes = ['AAPL', 'AMD', 'AMZN', 'ASML', 'BABA', 'CRCL', 'DELL', 'GME', 'GOOGL', 'INTC', 'META', 'MSFT', 'MSTR', 'MU', 'NVDA', 'PLTR', 'QQQ', 'SGOV', 'SLV', 'SNDK', 'SPCX', 'SPY', 'TSLA', 'TSM', 'USAR', 'USO']
  return (
    <VisualFrame title="FEE RESERVE" status="26 ROUTES" className="docs-rwa-visual">
      <div className="docs-rwa-path"><span>Key fill fee</span><b>→</b><span>ETH to USDG</span><b>→</b><span>Stock Token</span></div>
      <div className="docs-rwa-routes">{routes.map((route) => <span className={route === 'AAPL' ? 'held' : ''} key={route}>{route}</span>)}</div>
      <p className="docs-visual-note">AAPL held now · next route AMD · 3% maximum execution slippage</p>
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
    ['01', 'confirm', 'three saved receipts'],
    ['02', 'fund', 'onchain share preview'],
    ['03', 'keeper', 'policy acts or holds'],
    ['04', 'share', 'public performance'],
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
  if (kind === 'rwa') return <RwaReserveVisual />
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
        <span>The money path, public performance and creator records, System Pulse, Stock Token reserve, $MUPPETS launch gate, Key market and onchain limits.</span>
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
            <p>This is live mainnet software using real assets. APY is not promised. Morpho withdrawals depend on market liquidity, ranges can lose against holding WETH, and Stock Token purchases depend on oracle and pool liquidity. The owner is a dedicated deployment wallet rather than a multisig. Use small amounts until the contracts receive independent review.</p>
          </footer>
        </article>
      </div>
    </div>
  )
}
