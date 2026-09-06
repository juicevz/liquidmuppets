import { describe, expect, it } from 'vitest'
import { defaultMarketForTask, marketsForTask, strategyMarkets } from './strategyMarkets'

describe('strategy market catalog', () => {
  it('shows exactly one deployed route for every task', () => {
    for (const taskId of [0, 1, 2] as const) {
      const options = marketsForTask(taskId)
      expect(options).toHaveLength(1)
      expect(defaultMarketForTask(taskId).status).toBe('live')
    }
  })

  it('keeps FactoryV2 candidates visibly separate from live routes', () => {
    expect(strategyMarkets).toHaveLength(7)
    expect(strategyMarkets.filter((market) => market.status === 'live')).toHaveLength(3)
    expect(strategyMarkets.filter((market) => market.status === 'review')).toHaveLength(4)
    for (const taskId of [3, 4, 5, 6] as const) {
      expect(defaultMarketForTask(taskId).status).toBe('review')
    }
  })
})
