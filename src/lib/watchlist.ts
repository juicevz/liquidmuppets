export const WATCHLIST_STORAGE_KEY = 'liquidmuppets-monitor:v1'
export const WATCHLIST_CHANGE_EVENT = 'liquidmuppets:watchlist-change'

export interface WatchlistState {
  version: 1
  agentIds: number[]
  alertsReadThrough: string | null
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const EMPTY_STATE: WatchlistState = { version: 1, agentIds: [], alertsReadThrough: null }

export function parseWatchlistState(raw: string | null): WatchlistState {
  if (!raw) return { ...EMPTY_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<WatchlistState>
    const ids = Array.isArray(parsed.agentIds)
      ? parsed.agentIds.filter((id): id is number => Number.isSafeInteger(id) && id >= 0)
      : []
    const readThrough = typeof parsed.alertsReadThrough === 'string'
      && Number.isFinite(new Date(parsed.alertsReadThrough).getTime())
      ? parsed.alertsReadThrough
      : null
    return { version: 1, agentIds: [...new Set(ids)].slice(0, 200), alertsReadThrough: readThrough }
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function readWatchlistState(storage?: StorageLike): WatchlistState {
  const target = storage ?? browserStorage()
  if (!target) return { ...EMPTY_STATE }
  try {
    return parseWatchlistState(target.getItem(WATCHLIST_STORAGE_KEY))
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function writeWatchlistState(state: WatchlistState, storage?: StorageLike): WatchlistState {
  const normalized = parseWatchlistState(JSON.stringify(state))
  const target = storage ?? browserStorage()
  if (target) {
    try {
      target.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      return normalized
    }
  }
  return normalized
}

export function withAgentFollow(state: WatchlistState, agentId: number, following: boolean): WatchlistState {
  const ids = following
    ? [...state.agentIds, agentId]
    : state.agentIds.filter((id) => id !== agentId)
  return { ...state, agentIds: [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id >= 0).slice(0, 200) }
}

export function withAlertsReadThrough(state: WatchlistState, timestamp: string): WatchlistState {
  return { ...state, alertsReadThrough: Number.isFinite(new Date(timestamp).getTime()) ? timestamp : state.alertsReadThrough }
}

function browserStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage
}
