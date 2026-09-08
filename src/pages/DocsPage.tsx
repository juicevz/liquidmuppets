import type { ReactNode } from 'react'
import { pets } from '../data/pets'
import { publicRoadmap, roadmapBoundary, roadmapRepository, roadmapSequenceNote } from '../data/roadmap'
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
  link?: { label: string; href: string }
  visual?: DocsVisualKind
}

const docsSections: DocsSection[] = [
  {
    number: '01',
    title: 'The product loop',
    body: 'A Muppet is an onchain vault with one job. The first screen now explains that loop directly, while /about keeps the full product story. Every 15,000 $MUPPETS held unlocks one active Creator Slot. A creator picks a cosmetic pet and name, chooses one of three live vault jobs, then launches and funds it.',
    details: ['pet appearance has no financial effect', 'the task fixes the asset, adapter and risk caps', 'vault shares and Agent Keys remain separate', 'the optional Agent Key market opens only after launch'],
    visual: 'loop',
  },
  {
    number: '02',
    title: '$MUPPETS Creator Slots',
    body: 'Every public page remains open. Active slots equal floor((liquid balance + Agent-Bonded balance) / 15,000). One available slot permits one new Muppet and one featured Muppet on the creator profile. The API reads the canonical token, optional Agent Bond, and that wallet’s existing factory Muppets before a launch.',
    details: [
      'tokens remain liquid unless the holder deliberately opens a fixed 30, 90 or 180 day Agent Bond position',
      'Agent-Bonded $MUPPETS continue to fund Creator Slot capacity in FactoryV2',
      'creator pages show balance, unlocked slots, used slots, available slots and the exact next-launch threshold',
      'the newest Muppets fill currently funded featured placements; every Muppet remains in the full public record',
      'a lower balance pauses additional launches and over-capacity featured placement only; existing vaults, withdrawals and Agent Key markets remain available',
      'canonical token · 0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189',
      'the live V1 factory predates this rule, so the current path is app and API enforced; FactoryV2 carries the slot formula onchain but has not been broadcast',
    ],
  },
  {
    number: '03',
    title: 'Seven pets, three live tasks',
    body: 'Blue, sage, stone, fox, plum, frog and gold are appearance choices. Any pet can use stable yield, ETH range, or launch reserve. The beginner launch flow shows only those three live jobs. AAPL, NVDA, SPY and screened meme candidates remain documented in Market Radar and FactoryV2 review material. The pet never changes the money path or permissions.',
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
    body: 'Every settled legacy Key trade currently sends the 3% marketplace fee directly to FeeRwaReserve. At 0.0001 ETH, the private keeper can convert native ETH to USDG and buy the next eligible Robinhood Stock Token. The contract rotates across 26 enabled routes and caps each cycle at 0.01 ETH. After the verified migration, V2 fills enter an exact-Key 50/25/15/10 revenue lane.',
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
    body: 'The factory creates a fixed-supply, zero-decimal ERC-20 Agent Key with each Muppet. No Key is approved or listed in the launch transaction. After launch, the creator can optionally approve a chosen quantity and open the first ask in a clearly separate flow. The actual floor is always the cheapest active ask. KeyMarketplaceV2 preserves partial asks, bids, buys and sells while attaching the exact Key and gross volume to every settled fee.',
    details: ['Key ownership is not vault ownership', 'Key price does not change vault share price', 'utility is trading, permanent binding and exact-Key WETH eligibility after verified V2 activation', 'legacy fees stay global because the old marketplace transfer carries no Key address'],
    visual: 'keys',
  },
  {
    number: '10',
    title: 'Binding a Key',
    body: 'A holder can permanently bind whole Keys to their wallet. Binding burns the transferable units and records the bound balance in the Key contract. It does not mint an NFT and cannot claim vault assets.',
  },
  {
    number: '11',
    title: 'Earn and Agent Bonds',
    body: 'The public Revenue Engine, per-Muppet Key revenue views and tested contract package are shipped, but the new contracts are not yet deployed on mainnet. One base bond unit requires 15,000 $MUPPETS plus one unused, permanently bound Agent Key. Pons creator revenue keeps the global 50/30/20 route. Each V2 Key fee uses a separate 50/25/15/10 route for exact-Key WETH, $MUPPETS buyback, Stock Token reserve and operations.',
    details: [
      'the target 3% $MUPPETS trade-fee route is 0.300% Pons protocol, 0.350% Pons buyback, 1.175% Agent Bond rewards, 0.705% Stock Token reserve and 0.470% keeper and operations',
      'the Pons protocol and buyback portions happen before the 2.350% creator revenue enters the LiquidMuppets router',
      'a V2 Key fee sends 50% as WETH only to bonds using that Key, 25% to a $MUPPETS market buy, 15% to the Stock Token reserve and 10% to operations',
      'the buyback uses the graduated Pons v4 pool, a nonzero minimum output, a short deadline, a 0.01 ETH cap and a limited keeper',
      'each purchased $MUPPETS lot vests to the Safe for five years',
      'third-party or seeded funding is accounted separately and cannot appear as protocol revenue',
      'positions mature for seven days and earn only for full weekly epochs completed before their fixed unlock',
      'fixed terms are 30 days at 1x, 90 days at 1.25x or 180 days at 1.5x; the weight changes distribution share, not the real-fee reward pot',
      'fees stay attached to the week received by the router; delayed distribution cannot move them to later holders, and Pons escrow does not expose original trade weeks',
      'completed weeks finalize once, with catch-up limited to 20 nonempty weeks per call; zero-revenue weeks pay zero',
      'zero-eligibility reward shares remain held for their original week and cannot be recycled or recovered; this policy must be reviewed before activation',
      'global and exact-Key WETH use separate epoch accounting with position-bounded claims and no token emissions',
      'unbonding returns the position’s $MUPPETS after its fixed unlock, while the Agent Key remains permanently bound',
      'claim WETH or choose Buy more and stake: one atomic reward-funded purchase and a new 15,000-MUPPETS bond with one unused bound Key',
      'reinvestment shows a fresh quote, minimum received, gas and fixed lock before signing; old locks stay unchanged and leftovers return to the wallet',
      'if the purchase or bond fails, the whole reinvestment reverts; gas can still be charged and ordinary WETH claiming remains separate',
      'reward reinvestment is published but unavailable until verified contract activation; it does not introduce no-Key staking or change fee splits',
      'the /app/earn page shows staked MUPPETS, claimable WETH, lifetime rewards claimed, wallet WETH received and rewards reinvested, with unknown reads never displayed as zero',
      'each bond shows eligibility and unlock times; wallet receipts keep global and Key rewards separate, and deposits are not earnings',
      'Protocol details contains weekly fee records, splits and activation checks; existing /app/revenue links still work',
      'FactoryV2 still exceeds the EIP-170 runtime-size limit and must be reduced before the complete migration can be broadcast',
      'mainnet activation remains pending verified deployment, Safe ownership, independent review, Pons buyback activation and creator-recipient routing',
    ],
    link: { label: 'Open Earn', href: '/app/earn' },
    visual: 'keys',
  },
  {
    number: '12',
    title: 'How to use the live loop',
    body: 'Connect an EVM wallet on Robinhood Chain mainnet. The launch page shows live Creator Slot capacity. A first Muppet needs 15,000 $MUPPETS, a second needs 30,000, and each later Muppet adds another 15,000 threshold. Creation now has three stages: pet and name, one live job, then launch and fund. Launch uses one wallet confirmation. Funding remains a separate asset approval and vault deposit. Opening an Agent Key market is optional and separate after launch.',
    details: [
      'the submitted creation receipt is saved in this browser so Resume launch can recover it without creating a duplicate Muppet',
      'optional Key approval and listing receipts are saved independently in the same browser-local record',
      'recovery is scoped to this wallet, chain and factory and stores public transaction metadata only',
      'expected shares come from the deployed ERC-4626 previewDeposit call before funding',
      'the next keeper time is an estimate; policy can still act or hold',
    ],
    visual: 'steps',
  },
  {
    number: '13',
    title: 'Public activity and handles',
    body: 'The marketplace tape decodes launches, listings, fills, deposits, withdrawals, allocations, recalls and Key binding from mainnet logs. A wallet can sign an app-handle claim with no gas. If no handle is claimed, the tape shows the shortened wallet instead.',
    details: ['green values mark buys, deposits, launches and allocations', 'red values mark sells, withdrawals and recalls', 'asks and bids are neutral until they fill', 'an app handle proves wallet control, not ownership of an external social account'],
  },
  {
    number: '14',
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
      'that separate section labels legacy fees global only and shows exact V2 Key revenue from the deployment block forward',
    ],
  },
  {
    number: '15',
    title: 'Public creator profiles',
    body: 'Every creator wallet has a shareable /app/creator/{wallet} page. It shows that wallet’s live $MUPPETS balance, Creator Slots used and available, next-launch threshold, currently funded featured Muppets, recorded vault evidence and transaction receipts. Combined capital remains grouped by native asset, so USDG and WETH are never added into one number.',
    details: [
      'a wallet-signed app handle appears when one has been claimed; otherwise the exact wallet remains the identity',
      'each Muppet links to its own performance page and keeps its original tracking start',
      'featured placement follows the newest Muppets up to the number of funded slots; the complete Muppet ledger remains below it',
      'Agent Key markets sit below a separate speculative-market boundary and never enter vault totals',
      'new history begins with recorded checkpoints; no earlier APY or performance is invented',
    ],
  },
  {
    number: '16',
    title: 'System Pulse',
    body: 'System Pulse combines decoded transaction events and recorded keeper decisions into one reverse-chronological public feed. It covers launches, deposits, withdrawals, allocations, recalls, range changes, Key orders and fills, bindings, keeper actions and holds, and Stock Token reserve purchases.',
    details: [
      'chain events link to the exact transaction receipt and block',
      'keeper actions inherit the recorded policy reason when a matching receipt exists',
      'keeper holds are visible with their reason and say that no transaction was signed',
      'vault, range, keeper, Agent Key and Stock Token records can be filtered without mixing their economics',
      'a creator profile uses the same feed filtered to Muppets launched by that wallet',
      'brief RPC rate limits use a recent cache quietly; data older than five minutes is labeled stale',
    ],
  },
  {
    number: '17',
    title: 'Automatic Muppet Proof Cards',
    body: 'Every meaningful recorded event can become a durable /proof/{id} share page and an /app/proof/{id} evidence view. Cards cover Muppet launches, first deposits, keeper actions, range changes, whole-percentage flow-adjusted NAV milestones since tracking began, Agent Key fills and Stock Token reserve purchase receipts.',
    details: [
      'each card carries the Muppet, exact asset, pool or market, latest labeled health observation, UTC timestamp, receipt state and canonical $MUPPETS address',
      'routine keeper holds are grouped into one daily card per Muppet so scheduled checks do not bury meaningful events',
      'holds and checkpoint milestones explicitly say no transaction was signed rather than inventing a receipt',
      'milestones use recorded cash-flow-adjusted change and never project or annualize APY',
      'the public share URL renders server-side social metadata with a 1200 by 630 PNG and links back to the full in-app evidence view',
    ],
  },
  {
    number: '18',
    title: 'Watchlists and Market Radar',
    body: 'Follow any Muppet from the marketplace or its public performance page, then open /app/watchlist for a browser-local watchlist and evidence alert inbox. Market Radar separates three live routes from four FactoryV2 review candidates and cannot approve a route or move capital.',
    details: [
      'followed Muppet IDs and alert read state remain in this browser; no wallet or signature is required',
      'alerts cover range, health, oracle, keeper, vault, Agent Key and protocol-reserve evidence with receipt links when a transaction exists',
      'Radar labels every configured route live, review or rejected and gives the exact reason',
      '24 hour volume, pool age, expected execution cost and projected return stay not exposed when current adapters do not provide them',
      'no historical APY, USD liquidity conversion or route execution is invented by the Monitor surface',
    ],
  },
  {
    number: '19',
    title: 'Indexer and RPC reliability',
    body: 'System Pulse now indexes only new confirmed blocks plus a short reorg window. Decoded events, scan progress and the last healthy fee-reserve response survive API restarts in SQLite. Public pages keep the last successful timestamp visible when an upstream read fails.',
    details: [
      'log requests are chunked and background refreshes do not replay full history',
      'transport, rate-limit and retryable upstream errors fail over to the next configured RPC provider',
      'the public Robinhood RPC is rate-limited; an independent provider endpoint must be configured for real failover',
      'cached evidence becomes visibly stale after five minutes and is never presented as a fresh read',
    ],
  },
  {
    number: '20',
    title: 'FactoryV2 and reviewed templates',
    body: 'FactoryV2 implements one reusable creator slot per 15,000 liquid or Agent-Bonded $MUPPETS onchain, exact task and adapter registration, defensive, balanced and active presets, V1 read compatibility, and contract-governed ownership. Every legacy or V2 Muppet consumes one slot. It ships launch-disabled until Blockscout verification and an explicit Safe activation.',
    details: [
      'existing V1 vaults, withdrawals, policies and Key orders stay on their original contracts',
      'dropping below capacity cannot disable an existing vault or Agent Key market; it only blocks another launch',
      'NVDA / USDG passed a mainnet-fork open, allocation and full redemption test',
      'AAPL / USDG and SPY / USDG stay disabled while their EZManager pool approvals are false',
      'the meme / WETH slot stays disabled until one exact token, pool, oracle and exit path pass review',
      'no FactoryV2 deployment address is claimed because the migration has not been broadcast',
    ],
  },
  {
    number: '21',
    title: 'Public roadmap',
    body: `${roadmapBoundary} The current implementation and full operating notes stay available in the public repository.`,
    link: { label: 'Open the public repository', href: roadmapRepository },
    details: [
      ...publicRoadmap.map((phase) => `phase ${phase.number} · ${phase.status} · ${phase.title}: ${phase.items.join('; ')}`),
      roadmapSequenceNote,
    ],
  },
  {
    number: '22',
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
    ['01', 'launch', 'one saved receipt'],
    ['02', 'fund', 'approval + deposit'],
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
        <span>The money path, public performance, automatic Proof Cards, watchlists, Market Radar, System Pulse, Revenue Engine, Agent Bonds, Stock Token reserve, $MUPPETS launch gate, Key market and onchain limits.</span>
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
                {section.link && <a className="docs-section-link" href={section.link.href} target="_blank" rel="noreferrer">{section.link.label}</a>}
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
