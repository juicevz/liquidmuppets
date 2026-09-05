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

  it('does not advertise undeployed routes', () => {
    expect(strategyMarkets).toHaveLength(3)
    expect(strategyMarkets.every((market) => market.status === 'live')).toBe(true)
  })
})
