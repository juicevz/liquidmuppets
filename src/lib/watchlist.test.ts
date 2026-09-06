import { describe, expect, it } from 'vitest'
import {
  WATCHLIST_STORAGE_KEY,
  parseWatchlistState,
  readWatchlistState,
  withAgentFollow,
  withAlertsReadThrough,
  writeWatchlistState,
} from './watchlist'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: (key: string) => key === WATCHLIST_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === WATCHLIST_STORAGE_KEY) value = next },
    value: () => value,
  }
}

describe('browser-local watchlist state', () => {
  it('fails closed on malformed or unexpected storage', () => {
    expect(parseWatchlistState('{nope')).toEqual({ version: 1, agentIds: [], alertsReadThrough: null })
    expect(parseWatchlistState(JSON.stringify({ agentIds: [1, 1, -1, 2.5, 3, '4'] }))).toEqual({
      version: 1,
      agentIds: [1, 3],
      alertsReadThrough: null,
    })
  })

  it('follows and unfollows without duplicating a Muppet', () => {
    const empty = parseWatchlistState(null)
    const followed = withAgentFollow(withAgentFollow(empty, 7, true), 7, true)
    expect(followed.agentIds).toEqual([7])
    expect(withAgentFollow(followed, 7, false).agentIds).toEqual([])
  })

  it('persists public IDs and a valid alert read boundary only', () => {
    const storage = memoryStorage()
    const state = withAlertsReadThrough(withAgentFollow(parseWatchlistState(null), 2, true), '2026-09-06T11:00:00Z')
    writeWatchlistState(state, storage)
    expect(readWatchlistState(storage)).toEqual({
      version: 1,
      agentIds: [2],
      alertsReadThrough: '2026-09-06T11:00:00Z',
    })
    expect(storage.value()).not.toContain('wallet')
  })
})
