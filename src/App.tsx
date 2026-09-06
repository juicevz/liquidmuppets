import { useEffect, useState } from 'react'
import type { View } from './types'
import { creatorAddressFromPath, pathForView, performanceAgentIdFromPath, viewFromPath } from './lib/navigation'
import { AppShell } from './components/AppShell'
import { LandingPage } from './pages/LandingPage'

export function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.body.dataset.surface = view === 'landing' ? 'landing' : 'app'
    document.title = view === 'landing'
      ? 'LIQUIDMUPPETS | onchain liquidity agents'
      : `${view === 'marketplace' ? 'Pet Marketplace' : view === 'performance' ? 'Muppet Performance' : view === 'creator' ? 'Creator Profile' : view === 'pulse' ? 'System Pulse' : view === 'monitor' ? 'Watchlist and Market Radar' : view[0].toUpperCase() + view.slice(1)} | LIQUIDMUPPETS`
    window.scrollTo({ top: 0 })
  }, [view])

  const navigate = (next: View) => {
    if (next === 'performance' || next === 'creator') return
    if (next === view) return
    window.history.pushState({}, '', pathForView[next])
    setView(next)
  }

  if (view === 'landing') return <LandingPage onNavigate={navigate} />
  return (
    <AppShell
      view={view}
      performanceAgentId={performanceAgentIdFromPath(window.location.pathname)}
      creatorAddress={creatorAddressFromPath(window.location.pathname)}
      onNavigate={navigate}
    />
  )
}
