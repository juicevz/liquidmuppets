export type RoadmapState = 'shipped' | 'active' | 'pending'

export interface RoadmapPhase {
  number: string
  state: RoadmapState
  status: string
  title: string
  track?: string
  items: string[]
}

export const publicRoadmap: RoadmapPhase[] = [
  {
    number: '01',
    state: 'shipped',
    status: 'shipped',
    title: 'Market core',
    items: [
      'Public performance pages and creator profiles',
      '$MUPPETS Creator Slots in the app, API and public profiles',
      'Automatic proof cards and durable share URLs for meaningful records',
      'System Pulse with restart-safe incremental indexing',
      'Watchlists, alerts and Market Radar',
      'Three live task routes and a 26-route Stock Token reserve',
    ],
  },
  {
    number: '02',
    state: 'active',
    status: 'next',
    title: 'Resilience',
    items: [
      'Add an independent production RPC fallback',
      'Complete source verification',
      'Move protocol ownership to a verified Safe',
      'Commission an independent contract review',
    ],
  },
  {
    number: '03',
    state: 'pending',
    status: 'conditional',
    title: 'Permissioning',
    track: 'FactoryV2',
    items: [
      'Simulate and broadcast migration after Safe approval',
      'Enforce one creator slot per 15,000 $MUPPETS onchain while tokens remain in the wallet',
      'Preserve V1 vaults, withdrawals, policies and Key markets',
      'Enable new launches through a separate Safe transaction',
    ],
  },
  {
    number: '04',
    state: 'pending',
    status: 'conditional',
    title: 'Asset expansion',
    track: 'Route review',
    items: [
      'Activate NVDA / USDG only after verified FactoryV2 activation',
      'Keep AAPL / USDG and SPY / USDG disabled until venue approval',
      'Keep the meme / WETH route disabled until liquidity, age, volume, oracle and exit gates pass',
      'Expose volume, pool age and realized execution cost only when adapters source them',
    ],
  },
]

export const roadmapBoundary = 'Shipped means live or published. Later work stays conditional on verification and venue evidence.'
export const roadmapSequenceNote = 'Sequence can change when evidence changes.'
export const roadmapRepository = 'https://github.com/juicevz/liquidmuppets'
