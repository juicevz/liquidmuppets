import type { View } from '../types'

export const pathForView: Record<Exclude<View, 'performance' | 'creator' | 'proof'>, string> = {
  landing: '/',
  about: '/about',
  marketplace: '/app',
  portfolio: '/app/portfolio',
  create: '/app/create',
  docs: '/docs',
  pulse: '/app/pulse',
  proofs: '/app/proofs',
  monitor: '/app/watchlist',
  revenue: '/app/earn',
  stockDrops: '/app/stock-drops',
}

export function viewFromPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (/^\/app\/muppet\/\d+$/.test(path)) return 'performance'
  if (/^\/app\/creator\/0x[a-fA-F0-9]{40}$/.test(path)) return 'creator'
  if (/^\/app\/proof\/[a-z0-9-]+$/.test(path)) return 'proof'
  if (path === '/app/proofs') return 'proofs'
  if (path === '/app/watchlist') return 'monitor'
  if (path === '/app/stock-drops') return 'stockDrops'
  if (path === '/app/earn' || path === '/app/revenue') return 'revenue'
  if (path === '/app/pulse') return 'pulse'
  if (path === '/app/create') return 'create'
  if (path === '/app/portfolio') return 'portfolio'
  if (path === '/app') return 'marketplace'
  if (path === '/docs') return 'docs'
  if (path === '/about') return 'about'
  return 'landing'
}

export function performancePath(agentId: number | bigint): string {
  return `/app/muppet/${agentId.toString()}`
}

export function performanceAgentIdFromPath(pathname: string): number | null {
  const match = pathname.replace(/\/+$/, '').match(/^\/app\/muppet\/(\d+)$/)
  if (!match) return null
  const agentId = Number(match[1])
  return Number.isSafeInteger(agentId) ? agentId : null
}

export function creatorPath(wallet: string): string {
  return `/app/creator/${wallet}`
}

export function creatorAddressFromPath(pathname: string): string | null {
  const match = pathname.replace(/\/+$/, '').match(/^\/app\/creator\/(0x[a-fA-F0-9]{40})$/)
  return match?.[1] ?? null
}

export function proofPath(proofId: string): string {
  return `/app/proof/${proofId}`
}

export function proofIdFromPath(pathname: string): string | null {
  const match = pathname.replace(/\/+$/, '').match(/^\/app\/proof\/([a-z0-9-]+)$/)
  return match?.[1] ?? null
}
