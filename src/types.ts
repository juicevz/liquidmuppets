export type View = 'landing' | 'marketplace' | 'portfolio' | 'create' | 'docs'

export type StrategyTaskId = 0 | 1 | 2

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
  execution_mode: 'active' | 'reserve'
  execution_note: string
  safety_gates: Array<{ label: string; value: string }>
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
