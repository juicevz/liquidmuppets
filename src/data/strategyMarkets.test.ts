import { describe, expect, it } from 'vitest'
import { defaultMarketForTask, marketsForTask, strategyMarkets } from './strategyMarkets'

describe('strategy market catalog', () => {
  it('keeps exactly one launchable route for every deployed task', () => {
    for (const taskId of [0, 1, 2] as const) {
      const options = marketsForTask(taskId)
      expect(options.filter((market) => market.status === 'live')).toHaveLength(1)
      expect(defaultMarketForTask(taskId).status).toBe('live')
    }
  })

  it('keeps proposed Stock Token markets in review', () => {
    const proposedStockTokenMarkets = strategyMarkets.filter((market) => market.usesStockTokens)
    expect(proposedStockTokenMarkets.length).toBeGreaterThanOrEqual(6)
    expect(proposedStockTokenMarkets.every((market) => market.status === 'review')).toBe(true)
  })

  it('offers community markets without treating watchlist names as live pools', () => {
    const communityMarkets = marketsForTask(2).filter((market) => market.group === 'community')
    expect(communityMarkets.map((market) => market.title)).toEqual(['Meme / WETH', 'Meme / USDG'])
    expect(communityMarkets.every((market) => market.status === 'review')).toBe(true)
  })
})
