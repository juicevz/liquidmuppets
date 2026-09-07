import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_KEY_LISTING_QUANTITY,
  DEFAULT_AGENT_KEY_REFERENCE_PRICE_ETH,
  DEFAULT_AGENT_KEY_SUPPLY,
  defaultFundingAmount,
  deriveAgentKeySymbol,
} from './launchDefaults'

describe('guided launch defaults', () => {
  it('derives a valid fixed Key symbol without asking the beginner for market settings', () => {
    expect(deriveAgentKeySymbol('quiet fox', 3)).toBe('QUIETFOX')
    expect(deriveAgentKeySymbol('é', 2)).toBe('MUP3')
    expect(deriveAgentKeySymbol('very long muppet name', 0)).toBe('VERYLONGMU')
  })

  it('keeps funding and optional Key-market defaults explicit', () => {
    expect(defaultFundingAmount(0)).toBe('100')
    expect(defaultFundingAmount(1)).toBe('0.1')
    expect(defaultFundingAmount(2)).toBe('0.1')
    expect(DEFAULT_AGENT_KEY_SUPPLY).toBe(100)
    expect(DEFAULT_AGENT_KEY_LISTING_QUANTITY).toBe(20)
    expect(DEFAULT_AGENT_KEY_REFERENCE_PRICE_ETH).toBe('0.01')
  })
})
