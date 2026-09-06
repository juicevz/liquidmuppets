import { useCallback, useEffect, useState } from 'react'
import {
  WATCHLIST_CHANGE_EVENT,
  WATCHLIST_STORAGE_KEY,
  readWatchlistState,
  withAgentFollow,
  withAlertsReadThrough,
  writeWatchlistState,
  type WatchlistState,
} from '../lib/watchlist'

export function useWatchlist() {
  const [state, setState] = useState<WatchlistState>(() => readWatchlistState())

  useEffect(() => {
    const reload = () => setState(readWatchlistState())
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== WATCHLIST_STORAGE_KEY) return
      reload()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(WATCHLIST_CHANGE_EVENT, reload)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(WATCHLIST_CHANGE_EVENT, reload)
    }
  }, [])

  const commit = useCallback((next: WatchlistState) => {
    const stored = writeWatchlistState(next)
    setState(stored)
    window.dispatchEvent(new Event(WATCHLIST_CHANGE_EVENT))
  }, [])

  const setFollowing = useCallback((agentId: number, following: boolean) => {
    commit(withAgentFollow(readWatchlistState(), agentId, following))
  }, [commit])

  const markAlertsRead = useCallback((timestamp = new Date().toISOString()) => {
    commit(withAlertsReadThrough(readWatchlistState(), timestamp))
  }, [commit])

  return { state, setFollowing, markAlertsRead }
}
