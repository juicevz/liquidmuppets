import type { StrategyTaskDefinition } from '../types'

export interface ProtocolConfig {
  chainId: number
  chainName: string
  explorerUrl: string
  rpcUrl: string
  deploymentBlock: number
  factory: `0x${string}` | null
  policyExecutor: `0x${string}` | null
  keyMarketplace: `0x${string}` | null
  testUSDG: `0x${string}` | null
  testWETH: `0x${string}` | null
  stablePool: `0x${string}` | null
  ethPool: `0x${string}` | null
  launchPool: `0x${string}` | null
  USDG: `0x${string}`
  morpho: `0x${string}`
  stableMarketId: `0x${string}`
  stableAdapter: `0x${string}` | null
  rangeAdapter: `0x${string}` | null
  launchReserveAdapter: `0x${string}` | null
  WETH: `0x${string}`
  ezWrapper: `0x${string}`
  mode: 'testnet' | 'mainnet'
}

const apiRoot = '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText })) as { detail?: string }
    throw new Error(body.detail ?? `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchProtocolConfig(): Promise<ProtocolConfig> {
  return request('/contracts')
}

export function fetchStrategyTasks(): Promise<StrategyTaskDefinition[]> {
  return request('/strategies')
}

export interface WalletProfile {
  wallet: `0x${string}`
  handle: string
  created_at: string
  updated_at: string
}

export interface ProfileChallenge {
  nonce: string
  message: string
  expires_at: string
}

export function fetchWalletProfile(wallet: string): Promise<WalletProfile | null> {
  return request(`/profiles/${wallet}`)
}

export function createProfileChallenge(wallet: string, handle: string): Promise<ProfileChallenge> {
  return request('/profiles/challenge', {
    method: 'POST',
    body: JSON.stringify({ wallet, handle }),
  })
}

export function claimWalletProfile(wallet: string, handle: string, nonce: string, signature: string): Promise<WalletProfile> {
  return request('/profiles/claim', {
    method: 'POST',
    body: JSON.stringify({ wallet, handle, nonce, signature }),
  })
}

export type ActivityDirection = 'positive' | 'negative' | 'neutral'

export interface ActivityItem {
  id: string
  tx_hash: `0x${string}`
  block_number: number
  timestamp: string
  action: string
  actor: `0x${string}`
  handle: string | null
  agent_id: number | null
  agent_name: string | null
  key_symbol: string | null
  quantity: string | null
  value: string | null
  value_symbol: string | null
  direction: ActivityDirection
}

export function fetchActivity(limit = 40): Promise<ActivityItem[]> {
  return request(`/activity?limit=${limit}`)
}

export interface KeeperResult {
  vault: string
  action: 'allocate' | 'hold' | 'recall'
  amount: number
  reason: string
  tx_hash: string | null
  status: string
}

export function requestKeeperRun(vault: `0x${string}`): Promise<KeeperResult> {
  return request('/keeper/run', { method: 'POST', body: JSON.stringify({ vault }) })
}
