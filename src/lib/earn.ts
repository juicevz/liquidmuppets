export type EarnPositionPhase = 'maturing' | 'waiting_for_epoch' | 'eligible' | 'eligibility_complete' | 'unlocked' | 'withdrawn' | 'unavailable'

/** Raw token quantities stay exact; unavailable reads are never displayed as zero. */
export function formatEarnAmount(raw: string | null | undefined, symbol: string, maxFraction = 6): string {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return 'Unavailable'
  if (!Number.isInteger(maxFraction) || maxFraction < 0 || maxFraction > 18) throw new Error('Unsupported display precision.')
  const value = BigInt(raw)
  const base = 10n ** 18n
  const whole = value / base
  const fraction = (value % base).toString().padStart(18, '0').slice(0, maxFraction).replace(/0+$/, '')
  if (value > 0n && whole === 0n && fraction === '') {
    const threshold = maxFraction === 0 ? '1' : `0.${'0'.repeat(maxFraction - 1)}1`
    return `<${threshold} ${symbol}`
  }
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}${fraction ? `.${fraction}` : ''} ${symbol}`
}

/** Maturation and epoch eligibility are separate, as are the final epoch and unlock. */
export function getEarnPositionPhase(position: {
  now: number
  maturesAt: number
  eligibleFrom: number
  eligibleUntil: number
  unlockAt: number
  withdrawn: boolean
}): EarnPositionPhase {
  const { now, maturesAt, eligibleFrom, eligibleUntil, unlockAt, withdrawn } = position
  if (![now, maturesAt, eligibleFrom, eligibleUntil, unlockAt].every((value) => Number.isSafeInteger(value) && value >= 0)
    || eligibleFrom < maturesAt || eligibleUntil <= eligibleFrom || unlockAt < eligibleUntil) return 'unavailable'
  if (withdrawn) return 'withdrawn'
  if (now >= unlockAt) return 'unlocked'
  if (now >= eligibleUntil) return 'eligibility_complete'
  if (now >= eligibleFrom) return 'eligible'
  if (now >= maturesAt) return 'waiting_for_epoch'
  return 'maturing'
}
