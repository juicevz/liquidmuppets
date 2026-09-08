import { useEffect, useState } from 'react'
import type { View } from './types'
import { creatorAddressFromPath, pathForView, performanceAgentIdFromPath, proofIdFromPath, viewFromPath } from './lib/navigation'
import { AppShell } from './components/AppShell'
import { LandingPage } from './pages/LandingPage'
import { HomePage } from './pages/HomePage'

export function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.body.dataset.surface = view === 'landing' || view === 'about' ? 'landing' : 'app'
    document.title = view === 'landing'
      ? 'LIQUIDMUPPETS | onchain liquidity agents'
      : view === 'about'
        ? 'How LIQUIDMUPPETS works'
      : `${view === 'marketplace' ? 'Pet Marketplace' : view === 'performance' ? 'Muppet Performance' : view === 'creator' ? 'Creator Profile' : view === 'pulse' ? 'System Pulse' : view === 'proofs' ? 'Proof Cards' : view === 'proof' ? 'Public Proof' : view === 'monitor' ? 'Watchlist and Market Radar' : view === 'revenue' ? 'Earn' : view[0].toUpperCase() + view.slice(1)} | LIQUIDMUPPETS`
    window.scrollTo({ top: 0 })
  }, [view])

  const navigate = (next: View) => {
    if (next === 'performance' || next === 'creator' || next === 'proof') return
    if (next === view) return
    window.history.pushState({}, '', pathForView[next])
    setView(next)
  }

  if (view === 'landing') return <HomePage onNavigate={navigate} />
  if (view === 'about') return <LandingPage onNavigate={navigate} />
  return (
    <AppShell
      view={view}
      performanceAgentId={performanceAgentIdFromPath(window.location.pathname)}
      creatorAddress={creatorAddressFromPath(window.location.pathname)}
      proofId={proofIdFromPath(window.location.pathname)}
      onNavigate={navigate}
    />
  )
}
