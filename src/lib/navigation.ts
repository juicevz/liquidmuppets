import type { View } from '../types'

export const pathForView: Record<View, string> = {
  landing: '/',
  marketplace: '/app',
  portfolio: '/app/portfolio',
  create: '/app/create',
  docs: '/docs',
}

export function viewFromPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/app/create') return 'create'
  if (path === '/app/portfolio') return 'portfolio'
  if (path === '/app') return 'marketplace'
  if (path === '/docs') return 'docs'
  return 'landing'
}
