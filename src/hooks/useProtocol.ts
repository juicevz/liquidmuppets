import { useCallback, useEffect, useState } from 'react'
import { fetchProtocolConfig, fetchStrategyTasks, type ProtocolConfig } from '../lib/api'
import { loadProtocolSnapshot, type ProtocolSnapshot } from '../lib/protocol'
import type { StrategyTaskDefinition } from '../types'

interface ProtocolState {
  config: ProtocolConfig | null
  snapshot: ProtocolSnapshot | null
  tasks: StrategyTaskDefinition[]
  loading: boolean
  error: string
  refresh: () => void
}

export function useProtocol(walletAddress?: string): ProtocolState {
  const [config, setConfig] = useState<ProtocolConfig | null>(null)
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot | null>(null)
  const [tasks, setTasks] = useState<StrategyTaskDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        const [nextConfig, nextTasks] = await Promise.all([fetchProtocolConfig(), fetchStrategyTasks()])
        if (!active) return

        // Task selection is API metadata and must not disappear just because a
        // live RPC snapshot is temporarily unavailable.
        setConfig(nextConfig)
        setTasks(nextTasks)

        try {
          const nextSnapshot = await loadProtocolSnapshot(nextConfig, walletAddress)
          if (!active) return
          setSnapshot(nextSnapshot)
        } catch {
          if (!active) return
          setSnapshot(null)
          setError('Live marketplace data is temporarily unavailable. Task selection and wallet transactions still work.')
        }
      } catch (reason: unknown) {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Protocol data could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [refreshToken, walletAddress])

  return { config, snapshot, tasks, loading, error, refresh }
}
