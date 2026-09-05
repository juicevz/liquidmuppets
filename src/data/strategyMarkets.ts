import type { StrategyTaskId } from '../types'

export type StrategyMarketStatus = 'live'
export type StrategyMarketGroup = 'current'

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
]

export function marketsForTask(taskId: StrategyTaskId) {
  return strategyMarkets.filter((market) => market.taskId === taskId)
}

export function defaultMarketForTask(taskId: StrategyTaskId) {
  const options = marketsForTask(taskId)
  return options[0]
}
