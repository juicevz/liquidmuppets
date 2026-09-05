import type { View } from '../types'

export const pathForView: Record<Exclude<View, 'performance'>, string> = {
  landing: '/',
  marketplace: '/app',
  portfolio: '/app/portfolio',
  create: '/app/create',
  docs: '/docs',
}

export function viewFromPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (/^\/app\/muppet\/\d+$/.test(path)) return 'performance'
  if (path === '/app/create') return 'create'
  if (path === '/app/portfolio') return 'portfolio'
  if (path === '/app') return 'marketplace'
  if (path === '/docs') return 'docs'
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
