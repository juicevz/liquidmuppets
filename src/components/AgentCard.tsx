import type { Agent } from '../types'
import { formatEth, formatPercent } from '../lib/format'
import { Icon } from './Icon'
import { Sparkline } from './Sparkline'

interface AgentCardProps {
  agent: Agent
  compact?: boolean
  onSelect?: (agent: Agent) => void
}

export function AgentCard({ agent, compact = false, onSelect }: AgentCardProps) {
  const floorClass = agent.keyMarket.floorChange24h >= 0 ? 'positive' : 'negative'

  return (
    <article className={`agent-card${compact ? ' agent-card-compact' : ''}`}>
      <button className="agent-card-main" type="button" onClick={() => onSelect?.(agent)} disabled={!onSelect}>
        <span className="agent-card-index">${agent.keySymbol}</span>
        <span className={`agent-status agent-status-${agent.status}`}>
          <i />
          {agent.status}
        </span>
        <span className="agent-portrait-wrap">
          <img src={agent.portrait} alt="" className="agent-portrait" />
        </span>
        <span className="agent-identity">
          <strong>{agent.name}</strong>
          <small>{agent.creator} · {agent.play}</small>
        </span>
        {!compact && <span className="agent-description">{agent.description}</span>}
        <span className="agent-metrics">
          <span>
            <small>key floor</small>
            <strong>{formatEth(agent.keyMarket.floorPriceEth)}</strong>
          </span>
          <span>
            <small>1d floor</small>
            <strong className={floorClass}>{formatPercent(agent.keyMarket.floorChange24h)}</strong>
          </span>
        </span>
        <span className="agent-chart">
          <Sparkline values={agent.floorHistory} negative={agent.keyMarket.floorChange24h < 0} />
        </span>
        <span className="agent-card-foot">
          <span>
            <small>24h volume</small>
            <strong>{formatEth(agent.keyMarket.volume24hEth, 3)}</strong>
          </span>
          <span>{agent.keyMarket.sales24h} sales</span>
          <span>{agent.keyMarket.holders} holders</span>
          {onSelect && <Icon name="arrow" />}
        </span>
      </button>
      <span className="simulation-tag">simulated</span>
    </article>
  )
}
