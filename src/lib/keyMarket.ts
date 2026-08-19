import type { Agent } from '../types'

export type KeyOrderSide = 'buy' | 'sell' | 'offer'

export interface KeyMarketQuote {
  unitPriceEth: number
  subtotalEth: number
  feeEth: number
  settlementEth: number
}

export function quoteKeyOrder(agent: Agent, side: KeyOrderSide, quantity: number): KeyMarketQuote {
  const safeQuantity = Math.max(1, Math.floor(quantity))
  const market = agent.keyMarket
  const bookDepthAdjustment = Math.max(0, safeQuantity - 1)
  const unitPriceEth = side === 'buy'
    ? market.floorPriceEth * (1 + bookDepthAdjustment * 0.012)
    : side === 'sell'
      ? market.topBidEth * Math.max(0.9, 1 - bookDepthAdjustment * 0.008)
      : market.topBidEth * 1.01
  const subtotalEth = unitPriceEth * safeQuantity
  const feeEth = subtotalEth * market.marketFeeBps / 10_000

  return {
    unitPriceEth,
    subtotalEth,
    feeEth,
    settlementEth: side === 'sell' ? subtotalEth - feeEth : subtotalEth + feeEth,
  }
}

export function summarizeKeyMarkets(agents: Agent[]) {
  return agents.reduce(
    (summary, agent) => ({
      volume24hEth: summary.volume24hEth + agent.keyMarket.volume24hEth,
      sales24h: summary.sales24h + agent.keyMarket.sales24h,
      holders: summary.holders + agent.keyMarket.holders,
      listed: summary.listed + agent.keyMarket.listed,
    }),
    { volume24hEth: 0, sales24h: 0, holders: 0, listed: 0 },
  )
}
