import type { StrategyTaskId } from '../types'

export const DEFAULT_AGENT_KEY_SUPPLY = 100
export const DEFAULT_AGENT_KEY_LISTING_QUANTITY = 20
export const DEFAULT_AGENT_KEY_REFERENCE_PRICE_ETH = '0.01'

export function deriveAgentKeySymbol(name: string, petId: number): string {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const fallback = `MUP${petId + 1}`
  return (normalized.length >= 2 ? normalized : fallback).slice(0, 10)
}

export function defaultFundingAmount(taskId: StrategyTaskId): string {
  return taskId === 0 ? '100' : '0.1'
}
