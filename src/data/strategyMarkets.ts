import type { StrategyTaskId } from '../types'

export type StrategyMarketStatus = 'live' | 'review'
export type StrategyMarketGroup = 'current' | 'stock-token' | 'company-basket' | 'community'

export interface StrategyMarketOption {
  id: string
  taskId: StrategyTaskId
  group: StrategyMarketGroup
  groupLabel: string
  title: string
  market: string
  status: StrategyMarketStatus
  description: string
  checks: string[]
  usesStockTokens?: boolean
}

export const strategyMarkets: StrategyMarketOption[] = [
  {
    id: 'usdg-morpho',
    taskId: 0,
    group: 'current',
    groupLabel: 'current route',
    title: 'USDG lending',
    market: 'Morpho Blue · USDG',
    status: 'live',
    description: 'Supplies bounded USDG into the vault\'s existing immutable Morpho market while keeping a cash reserve.',
    checks: ['fixed market ID', 'oracle and utilization limits', '10,000 USDG vault cap'],
  },
  {
    id: 'nvda-credit',
    taskId: 0,
    group: 'stock-token',
    groupLabel: 'Stock Token',
    title: 'Stock Token credit',
    market: 'NVDA Stock Token · USDG',
    status: 'review',
    description: 'A proposed lending route using a Stock Token as collateral and USDG as the borrowed or supplied asset.',
    checks: ['collateral parameters', 'feed and multiplier handling', 'liquidation depth'],
    usesStockTokens: true,
  },
  {
    id: 'ai-company-basket',
    taskId: 0,
    group: 'company-basket',
    groupLabel: 'company basket',
    title: 'AI company basket',
    market: 'NVDA · MSFT · GOOGL',
    status: 'review',
    description: 'A proposed rules-based basket with separate weights, caps, and price checks for each Stock Token.',
    checks: ['per-asset feeds', 'weight and drift limits', 'basket exit liquidity'],
    usesStockTokens: true,
  },
  {
    id: 'weth-usdg-range',
    taskId: 1,
    group: 'current',
    groupLabel: 'current route',
    title: 'ETH market',
    market: 'WETH / USDG',
    status: 'live',
    description: 'Runs the existing separately-accounted EZManager range with a fixed width and bounded allocation.',
    checks: ['canonical pool', 'fixed range width', '1 WETH vault cap'],
  },
  {
    id: 'nvda-usdg-range',
    taskId: 1,
    group: 'stock-token',
    groupLabel: 'Stock Token',
    title: 'NVIDIA market',
    market: 'NVDA / USDG',
    status: 'review',
    description: 'A proposed concentrated-liquidity range around the NVDA Stock Token and USDG market.',
    checks: ['canonical asset contract', 'feed-aware range logic', 'two-sided exit depth'],
    usesStockTokens: true,
  },
  {
    id: 'gme-usdg-range',
    taskId: 1,
    group: 'stock-token',
    groupLabel: 'Stock Token',
    title: 'GameStop market',
    market: 'GME / USDG',
    status: 'review',
    description: 'A proposed GME Stock Token range with its own volatility, inventory, and recenter limits.',
    checks: ['canonical asset contract', 'volatility-sized range', 'recenter and exit limits'],
    usesStockTokens: true,
  },
  {
    id: 'spcx-usdg-range',
    taskId: 1,
    group: 'stock-token',
    groupLabel: 'Stock Token',
    title: 'SpaceX market',
    market: 'SPCX / USDG',
    status: 'review',
    description: 'A proposed SPCX Stock Token range with route-specific inventory and liquidity controls.',
    checks: ['canonical asset contract', 'market-hours pricing behavior', 'two-sided exit depth'],
    usesStockTokens: true,
  },
  {
    id: 'spy-usdg-range',
    taskId: 1,
    group: 'stock-token',
    groupLabel: 'Stock Token',
    title: 'S&P 500 market',
    market: 'SPY / USDG',
    status: 'review',
    description: 'A proposed SPY Stock Token range designed around a broader company index exposure.',
    checks: ['canonical asset contract', 'feed-aware range logic', 'liquidity and fee study'],
    usesStockTokens: true,
  },
  {
    id: 'weth-launch-reserve',
    taskId: 2,
    group: 'current',
    groupLabel: 'current route',
    title: 'WETH reserve',
    market: 'Isolated WETH',
    status: 'live',
    description: 'Stages a bounded WETH reserve. It remains recallable and does not enter a token pool today.',
    checks: ['isolated accounting', '10% staging limit', '0.25 WETH vault cap'],
  },
  {
    id: 'community-weth-market',
    taskId: 2,
    group: 'community',
    groupLabel: 'community market',
    title: 'Meme / WETH',
    market: 'reviewed token / WETH',
    status: 'review',
    description: 'A proposed route for established community assets. DOGE, PEPE, and SHIB are watchlist examples, not approved pools.',
    checks: ['contract identity and pool age', 'volume and exit depth', 'oracle and holder concentration'],
  },
  {
    id: 'community-usdg-market',
    taskId: 2,
    group: 'community',
    groupLabel: 'community market',
    title: 'Meme / USDG',
    market: 'reviewed token / USDG',
    status: 'review',
    description: 'A proposed USDG-denominated market for a reviewed community token with smaller caps and stricter exits.',
    checks: ['canonical route verification', 'minimum USDG liquidity', 'emergency recall path'],
  },
]

export function marketsForTask(taskId: StrategyTaskId) {
  return strategyMarkets.filter((market) => market.taskId === taskId)
}

export function defaultMarketForTask(taskId: StrategyTaskId) {
  const options = marketsForTask(taskId)
  return options.find((market) => market.status === 'live') ?? options[0]
}
