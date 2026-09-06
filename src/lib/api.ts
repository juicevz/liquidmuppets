import type { StrategyTaskDefinition } from '../types'

export interface ProtocolConfig {
  chainId: number
  chainName: string
  explorerUrl: string
  rpcUrl: string
  deploymentBlock: number
  factory: `0x${string}` | null
  policyExecutor: `0x${string}` | null
  keyMarketplace: `0x${string}` | null
  feeRwaReserve: `0x${string}` | null
  testUSDG: `0x${string}` | null
  testWETH: `0x${string}` | null
  stablePool: `0x${string}` | null
  ethPool: `0x${string}` | null
  launchPool: `0x${string}` | null
  USDG: `0x${string}`
  morpho: `0x${string}`
  stableMarketId: `0x${string}`
  stableAdapter: `0x${string}` | null
  rangeAdapter: `0x${string}` | null
  launchReserveAdapter: `0x${string}` | null
  WETH: `0x${string}`
  ezWrapper: `0x${string}`
  accessGate: {
    feature: 'agent_launch'
    tokenAddress: `0x${string}` | null
    tokenSymbol: string
    minimum: string
    configured: boolean
    enforcement: 'app_and_api'
  }
  mode: 'testnet' | 'mainnet'
}

const apiRoot = '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: string }
    throw new Error(body.detail ?? `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchProtocolConfig(): Promise<ProtocolConfig> {
  return request('/contracts')
}

export function fetchStrategyTasks(): Promise<StrategyTaskDefinition[]> {
  return request('/strategies')
}

export interface TokenAccess {
  wallet: `0x${string}`
  feature: 'agent_launch'
  configured: boolean
  eligible: boolean
  tokenAddress: `0x${string}` | null
  tokenSymbol: string
  minimum: string
  decimals: number | null
  balance: string | null
  balanceRaw: string | null
  minimumRaw: string | null
  reason: 'eligible' | 'below_minimum' | 'token_not_configured' | 'access_check_unavailable'
  source: string
}

export function fetchTokenAccess(wallet: string): Promise<TokenAccess> {
  return request(`/access/${wallet}`, { cache: 'no-store' })
}

export interface WalletProfile {
  wallet: `0x${string}`
  handle: string
  created_at: string
  updated_at: string
}

export interface ProfileChallenge {
  nonce: string
  message: string
  expires_at: string
}

export function fetchWalletProfile(wallet: string): Promise<WalletProfile | null> {
  return request(`/profiles/${wallet}`)
}

export function createProfileChallenge(wallet: string, handle: string): Promise<ProfileChallenge> {
  return request('/profiles/challenge', {
    method: 'POST',
    body: JSON.stringify({ wallet, handle }),
  })
}

export function claimWalletProfile(wallet: string, handle: string, nonce: string, signature: string): Promise<WalletProfile> {
  return request('/profiles/claim', {
    method: 'POST',
    body: JSON.stringify({ wallet, handle, nonce, signature }),
  })
}

export type ActivityDirection = 'positive' | 'negative' | 'neutral'

export interface ActivityItem {
  id: string
  tx_hash: `0x${string}`
  block_number: number
  timestamp: string
  action: string
  actor: `0x${string}`
  creator: `0x${string}` | null
  handle: string | null
  agent_id: number | null
  agent_name: string | null
  key_symbol: string | null
  quantity: string | null
  value: string | null
  value_symbol: string | null
  direction: ActivityDirection
}

export function fetchActivity(limit = 40): Promise<ActivityItem[]> {
  return request(`/activity?limit=${limit}`)
}

export function fetchAgentActivity(agentId: number, limit = 100): Promise<ActivityItem[]> {
  return request(`/activity?agent_id=${agentId}&limit=${limit}`, { cache: 'no-store' })
}

export interface PerformanceCheckpoint {
  block_number: number
  timestamp: string
  total_assets_raw: string
  total_supply_raw: string
  share_price_raw: string
  idle_assets_raw: string
  deployed_assets_raw: string
  deposits_raw: string
  withdrawals_raw: string
  flow_adjusted_change_raw: string
  flow_adjusted_change_bps: number | null
}

export interface MarketEvidence {
  task_id: number
  route: string
  asset: { address: `0x${string}`; symbol: string }
  adapter: `0x${string}`
  venue: string
  pair?: string
  pool: `0x${string}` | null
  market_id?: string | null
  range: {
    status: 'open' | 'next_target'
    position_key: string | null
    lower_tick: number
    upper_tick: number
    current_tick: number
    in_range: boolean | null
    tick_spacing: number
    half_range_ticks: number
  } | null
  oracle: {
    status: 'value_available_timestamp_not_exposed' | 'unavailable' | 'not_used'
    address?: `0x${string}`
    updated_at: string | null
    age_seconds: number | null
    detail: string
    price_raw?: string
  }
  health: {
    status: 'healthy' | 'blocked' | 'mismatch' | 'unavailable'
    detail: string
    metrics: Record<string, string | number | boolean | null>
  }
}

export interface PerformanceKeeperDecision {
  id: number
  vault: `0x${string}`
  task_id: number
  action: string
  amount: string
  reason: string
  status: string
  tx_hash: `0x${string}` | null
  created_at: string
}

export interface PerformanceKeyMarket {
  status: 'available' | 'unavailable'
  detail: string
  symbol: string | null
  supply_raw: string | null
  total_bound_raw: string | null
  listed_raw: string | null
  floor_wei: string | null
  top_bid_wei: string | null
  fee_bps: number | null
}

export interface MuppetPerformance {
  network: {
    chain_id: number
    chain_name: string
    explorer_url: string
  }
  agent: {
    id: number
    name: string
    creator: `0x${string}`
    pet_id: number
    task_id: number
    task_label: string
    created_at: number
    vault: `0x${string}`
    key: `0x${string}`
  }
  tracking_started_at: string
  captured_at: string
  asset: { address: `0x${string}`; symbol: string; decimals: number }
  share: { symbol: string; decimals: number }
  current: PerformanceCheckpoint
  history: PerformanceCheckpoint[]
  change_method: { id: string; label: string; explanation: string }
  market: MarketEvidence
  keeper: PerformanceKeeperDecision | null
  key_market: PerformanceKeyMarket
}

export function fetchMuppetPerformance(agentId: number): Promise<MuppetPerformance> {
  return request(`/agents/${agentId}/performance`, { cache: 'no-store' })
}

export interface MarketplacePerformanceSummary {
  agent: MuppetPerformance['agent']
  tracking_started_at: string
  captured_at: string
  checkpoint_count: number
  market_observed_at: string
  market_refresh_failed_at: string | null
  asset: MuppetPerformance['asset']
  current: PerformanceCheckpoint
  change_method: MuppetPerformance['change_method']
  market: MarketEvidence
  keeper: PerformanceKeeperDecision | null
  key_market: PerformanceKeyMarket
}

export interface MarketplacePerformanceResponse {
  generated_at: string
  items: MarketplacePerformanceSummary[]
}

export function fetchMarketplacePerformance(): Promise<MarketplacePerformanceResponse> {
  return request('/marketplace/performance', { cache: 'no-store' })
}

export interface CreatorAssetTotal {
  address: `0x${string}`
  symbol: string
  decimals: number
  agent_count: number
  total_assets_raw: string
  deployed_assets_raw: string
  idle_assets_raw: string
}

export interface CreatorAgentRecord extends MarketplacePerformanceSummary {
  receipt_count: number
}

export interface CreatorProfileResponse {
  generated_at: string
  explorer_url: string
  wallet: `0x${string}`
  handle: string | null
  profile_claimed_at: string | null
  tracking_started_at: string | null
  captured_at: string | null
  activity_status: 'available' | 'cached' | 'stale' | 'unavailable'
  receipt_count: number | null
  asset_totals: CreatorAssetTotal[]
  agents: CreatorAgentRecord[]
}

export function fetchCreatorProfile(wallet: string): Promise<CreatorProfileResponse> {
  return request(`/creators/${wallet}`, { cache: 'no-store' })
}

export type PulseCategory = 'muppet' | 'vault' | 'keeper' | 'range' | 'keys' | 'reserve'

export interface PulseItem {
  id: string
  source: 'chain' | 'keeper'
  category: PulseCategory
  facets: PulseCategory[]
  timestamp: string
  action: string
  actor: `0x${string}` | null
  actor_handle: string | null
  creator: `0x${string}` | null
  creator_handle: string | null
  agent_id: number | null
  agent_name: string | null
  key_symbol: string | null
  quantity: string | null
  value: string | null
  value_symbol: string | null
  direction: ActivityDirection
  reason: string | null
  status: string | null
  tx_hash: `0x${string}` | null
  block_number: number | null
}

export interface PulseResponse {
  generated_at: string
  explorer_url: string
  latest_chain_record_at: string | null
  limit: number
  source_status: { chain: 'available' | 'cached' | 'stale' | 'unavailable'; keeper: 'available' }
  items: PulseItem[]
}

export function fetchSystemPulse(options: {
  limit?: number
  category?: PulseCategory
  creator?: string
  agentId?: number
} = {}): Promise<PulseResponse> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 100) })
  if (options.category) params.set('category', options.category)
  if (options.creator) params.set('creator', options.creator)
  if (options.agentId !== undefined) params.set('agent_id', String(options.agentId))
  return request(`/pulse?${params.toString()}`, { cache: 'no-store' })
}

export interface RwaReserveRoute {
  index: number
  symbol: string
  token: `0x${string}`
  feed: `0x${string}`
  pool: `0x${string}`
  poolFee: number
  maxOracleAge: number
  enabled: boolean
  balanceRaw: string
}

export interface RwaReserveState {
  configured: boolean
  address: `0x${string}` | null
  routeCount?: number
  purchaseCount?: number
  nextRouteIndex?: number
  totalNativeSpentWei?: string
  totalUsdgSpentRaw?: string
  totalFeesReceivedWei?: string
  minimumCycleWei?: string
  maximumCycleWei?: string
  cooldownSeconds?: number
  slippageBps?: number
  lastCycleAt?: number
  paused?: boolean
  availableCycleWei?: string
  nativeBalanceWei?: string
  blockNumber?: number
  stale?: boolean
  routes?: RwaReserveRoute[]
}

export async function fetchRwaReserve(): Promise<RwaReserveState> {
  let lastError: unknown
  for (const delayMs of [0, 600, 1_600]) {
    if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs))
    try {
      return await request('/rwa-reserve', { cache: 'no-store' })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export interface KeeperResult {
  vault: string
  action: 'allocate' | 'hold' | 'recall'
  amount: number
  reason: string
  tx_hash: string | null
  status: string
}

export function requestKeeperRun(vault: `0x${string}`): Promise<KeeperResult> {
  return request('/keeper/run', { method: 'POST', body: JSON.stringify({ vault }) })
}
