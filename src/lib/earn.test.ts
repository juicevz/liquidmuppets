import { describe, expect, it } from 'vitest'
import { formatEarnAmount, getEarnPositionPhase } from './earn'

describe('Earn quantities', () => {
  it('keeps unavailable and invalid reads distinct from verified zero', () => {
    for (const value of [undefined, null, '', '-1', '1.5', '1e18', 'NaN']) expect(formatEarnAmount(value, 'WETH')).toBe('Unavailable')
    expect(formatEarnAmount('0', 'WETH')).toBe('0 WETH')
  })

  it('does not silently display a tiny earned balance as zero', () => {
    expect(formatEarnAmount('1', 'WETH')).toBe('<0.000001 WETH')
    expect(formatEarnAmount('1000000000000', 'WETH')).toBe('0.000001 WETH')
    expect(formatEarnAmount('1', '$MUPPETS', 0)).toBe('<1 $MUPPETS')
    expect(formatEarnAmount('1', 'WETH', 18)).toBe('0.000000000000000001 WETH')
  })

  it('formats staked tokens and WETH without floating-point rounding or precision loss', () => {
    expect(formatEarnAmount('15000000000000000000000', '$MUPPETS')).toBe('15,000 $MUPPETS')
    expect(formatEarnAmount('12034000000000000', 'WETH')).toBe('0.012034 WETH')
    expect(formatEarnAmount('9007199254740993000000000000000001', '$MUPPETS')).toBe('9,007,199,254,740,993 $MUPPETS')
  })
})

describe('Earn position eligibility', () => {
  const position = { maturesAt: 700, eligibleFrom: 900, eligibleUntil: 2200, unlockAt: 3000, withdrawn: false }
  it.each([
    [699, 'maturing'], [700, 'waiting_for_epoch'], [899, 'waiting_for_epoch'],
    [900, 'eligible'], [2199, 'eligible'], [2200, 'eligibility_complete'],
    [2999, 'eligibility_complete'], [3000, 'unlocked'],
  ] as const)('reports the exact phase at timestamp %s', (now, phase) => {
    expect(getEarnPositionPhase({ ...position, now })).toBe(phase)
  })

  it('preserves withdrawn status and rejects missing or inconsistent schedule evidence', () => {
    expect(getEarnPositionPhase({ ...position, now: 3001, withdrawn: true })).toBe('withdrawn')
    expect(getEarnPositionPhase({ ...position, now: 1000, eligibleFrom: 600 })).toBe('unavailable')
    expect(getEarnPositionPhase({ ...position, now: 1000, unlockAt: 2100 })).toBe('unavailable')
    expect(getEarnPositionPhase({ ...position, now: Number.NaN })).toBe('unavailable')
  })
})
