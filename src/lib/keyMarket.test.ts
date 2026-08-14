import { describe, expect, it } from 'vitest'
import { agents } from '../data/agents'
import { quoteKeyOrder, summarizeKeyMarkets } from './keyMarket'

describe('Agent Key market accounting', () => {
  const agent = agents[0]

  it('anchors buys to the lowest ask and applies the disclosed fee', () => {
    const quote = quoteKeyOrder(agent, 'buy', 1)
    expect(quote.unitPriceEth).toBe(agent.keyMarket.floorPriceEth)
    expect(quote.feeEth).toBeCloseTo(quote.subtotalEth * 0.03)
    expect(quote.settlementEth).toBeCloseTo(quote.subtotalEth + quote.feeEth)
  })

  it('anchors sells to the best bid and subtracts the fee', () => {
    const quote = quoteKeyOrder(agent, 'sell', 1)
    expect(quote.unitPriceEth).toBe(agent.keyMarket.topBidEth)
    expect(quote.settlementEth).toBeCloseTo(quote.subtotalEth - quote.feeEth)
  })

  it('summarizes only observable key-market metrics', () => {
    const summary = summarizeKeyMarkets(agents)
    expect(summary.sales24h).toBe(247)
    expect(summary.holders).toBe(446)
    expect(summary.listed).toBe(74)
    expect(summary.volume24hEth).toBeCloseTo(7.312)
  })
})
