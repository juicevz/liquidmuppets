import type { StrategyTaskId } from '../types'

export type StrategyMarketStatus = 'live' | 'review'
export type StrategyMarketGroup = 'current' | 'factory-v2'

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
    id: 'weth-launch-reserve',
    taskId: 2,
    group: 'current',
    groupLabel: 'current route',
    title: 'WETH reserve',
    market: 'Isolated WETH',
    status: 'live',
    description: 'Stages bounded WETH in isolated accounting. The position remains recallable and earns no external pool fees.',
    checks: ['isolated accounting', '10% staging limit', '0.25 WETH vault cap'],
  },
  {
    id: 'aapl-usdg-range',
    taskId: 3,
    group: 'factory-v2',
    groupLabel: 'FactoryV2 candidate',
    title: 'AAPL market',
    market: 'AAPL / USDG',
    status: 'review',
    description: 'A USDG-accounted concentrated range using the exact AAPL pool and a freshness-bounded stock oracle.',
    checks: ['exact 0.05% pool', 'oracle no older than 3 days', 'EZManager approval still required'],
  },
  {
    id: 'nvda-usdg-range',
    taskId: 4,
    group: 'factory-v2',
    groupLabel: 'FactoryV2 candidate',
    title: 'NVDA market',
    market: 'NVDA / USDG',
    status: 'review',
    description: 'A USDG-accounted concentrated range with separate per-vault position accounting and a tested full exit path.',
    checks: ['exact 0.05% pool', 'venue allowlist observed', 'mainnet-fork redemption passed'],
  },
  {
    id: 'spy-usdg-range',
    taskId: 5,
    group: 'factory-v2',
    groupLabel: 'FactoryV2 candidate',
    title: 'SPY market',
    market: 'SPY / USDG',
    status: 'review',
    description: 'A defensive USDG-accounted index-token range prepared for the reviewed FactoryV2 adapter path.',
    checks: ['exact 0.05% pool', 'oracle no older than 3 days', 'EZManager approval still required'],
  },
  {
    id: 'screened-meme-weth',
    taskId: 6,
    group: 'factory-v2',
    groupLabel: 'FactoryV2 candidate',
    title: 'screened meme market',
    market: 'meme / WETH',
    status: 'review',
    description: 'A candidate route slot with no token selected. It stays disabled until liquidity, age, volume, oracle and exit checks pass.',
    checks: ['$250k minimum liquidity', '30 day minimum pool age', '$50k minimum 24h volume'],
  },
]

export function marketsForTask(taskId: StrategyTaskId) {
  return strategyMarkets.filter((market) => market.taskId === taskId)
}

export function defaultMarketForTask(taskId: StrategyTaskId) {
  const options = marketsForTask(taskId)
  const first = options[0]
  if (!first) throw new Error(`No market is defined for task ${taskId}.`)
  return first
}
