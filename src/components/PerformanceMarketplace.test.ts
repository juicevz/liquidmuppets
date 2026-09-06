import { describe, expect, it } from 'vitest'
import type { MarketplacePerformanceSummary } from '../lib/api'
import {
  formatBasisPoints,
  formatDeployedPercent,
  formatElapsed,
  formatIdlePercent,
  oracleLabel,
} from './PerformanceMarketplace'

function summaryWithOracle(
  status: MarketplacePerformanceSummary['market']['oracle']['status'],
  ageSeconds: number | null,
): MarketplacePerformanceSummary {
  return {
    market: {
      oracle: { status, age_seconds: ageSeconds },
    },
  } as MarketplacePerformanceSummary
}

describe('marketplace performance formatting', () => {
  it('keeps flow-adjusted changes distinct from an unavailable baseline', () => {
    expect(formatBasisPoints(125)).toBe('+1.25%')
    expect(formatBasisPoints(-70)).toBe('-0.70%')
    expect(formatBasisPoints(0)).toBe('0.00%')
    expect(formatBasisPoints(null)).toBe('baseline only')
  })

  it('shows deployed and idle shares from the same current NAV', () => {
    expect(formatDeployedPercent('850', '1000')).toBe('85.00%')
    expect(formatIdlePercent('850', '1000')).toBe('15.00%')
    expect(formatDeployedPercent('0', '0')).toBe('0.00%')
    expect(formatIdlePercent('0', '0')).toBe('100.00%')
  })

  it('keeps each observed tracking window explicit', () => {
    expect(formatElapsed('2026-09-05T20:00:00Z', '2026-09-06T22:30:00Z')).toBe('1d 2h')
  })

  it('does not call an oracle fresh when its timestamp is unavailable', () => {
    expect(oracleLabel(summaryWithOracle('value_available_timestamp_not_exposed', null))).toBe('timestamp not exposed')
    expect(oracleLabel(summaryWithOracle('not_used', null))).toBe('not used')
    expect(oracleLabel(summaryWithOracle('unavailable', null))).toBe('unavailable')
    expect(oracleLabel(summaryWithOracle('unavailable', 95))).toBe('1m old')
  })
})
