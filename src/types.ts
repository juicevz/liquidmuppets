export type View = 'landing' | 'marketplace' | 'portfolio' | 'create' | 'docs' | 'performance' | 'creator' | 'pulse' | 'proofs' | 'proof' | 'monitor'

export type StrategyTaskId = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface StrategyRiskPreset {
  id: 'defensive' | 'balanced' | 'active'
  max_single_bps: number
  max_daily_bps: number
  max_allocation_bps: number
  cooldown_seconds: number
}

export interface PetAppearance {
  id: number
  name: string
  portrait: string
}

export interface StrategyTaskDefinition {
  id: StrategyTaskId
  slug: string
  label: string
  deposit_asset: string
  share_prefix: string
  production_route: string
  testnet_route: string
  target_allocation_bps: number
  protocol_fee_bps: number
  live: boolean
  execution_mode: 'active' | 'reserve' | 'review'
  execution_note: string
  safety_gates: Array<{ label: string; value: string }>
  risk_presets: StrategyRiskPreset[]
}

export type AgentStatus = 'live' | 'paused' | 'settling' | 'simulation'

export type AgentCategory = 'market-making' | 'launch-liquidity' | 'yield-routing'

export interface AgentPosition {
  market: string
  venue: string
  allocation: number
}

export interface KeyMarketStats {
  floorPriceEth: number
  floorChange24h: number
  topBidEth: number
  volume24hEth: number
  sales24h: number
  listed: number
  supply: number
  holders: number
  boundKeys: number
  marketFeeBps: number
}

export interface Agent {
  id: string
  name: string
  creator: string
  category: AgentCategory
  play: string
  keySymbol: string
  description: string
  ageDays: number
  tvl: number
  return30d: number
  maxDrawdown: number
  status: AgentStatus
  portrait: string
  sparkline: number[]
  floorHistory: number[]
  positions: AgentPosition[]
  keyMarket: KeyMarketStats
  keyUtilities: string[]
}

export interface WalletProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: WalletProvider
  }
}
