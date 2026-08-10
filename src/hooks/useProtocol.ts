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
    Promise.all([fetchProtocolConfig(), fetchStrategyTasks()])
      .then(async ([nextConfig, nextTasks]) => {
        const nextSnapshot = await loadProtocolSnapshot(nextConfig, walletAddress)
        if (!active) return
        setConfig(nextConfig)
        setTasks(nextTasks)
        setSnapshot(nextSnapshot)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : 'Protocol data could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [refreshToken, walletAddress])

  return { config, snapshot, tasks, loading, error, refresh }
}

