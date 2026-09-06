import { Icon } from './Icon'
import { creatorPath, performancePath } from '../lib/navigation'
import { shortenAddress } from '../lib/format'
import type { PulseItem } from '../lib/api'

interface SystemPulseProps {
  items: PulseItem[]
  explorerUrl: string
  compact?: boolean
}

export function SystemPulse({ items, explorerUrl, compact = false }: SystemPulseProps) {
  if (items.length === 0) {
    return (
      <div className="pulse-empty">
        <Icon name="clock" />
        <div><strong>No matching records yet.</strong><p>The next decoded receipt or keeper decision will appear here.</p></div>
      </div>
    )
  }

  let previousDay = ''
  return (
    <div className={`pulse-feed${compact ? ' pulse-feed-compact' : ''}`} aria-live="polite">
      {items.map((item) => {
        const day = utcDay(item.timestamp)
        const showDay = day !== previousDay
        previousDay = day
        return (
          <div className="pulse-feed-block" key={item.id}>
            {showDay && <div className="pulse-day"><span>{day}</span><i /></div>}
            <article className={`pulse-record pulse-${item.category} pulse-${item.direction}`}>
              <div className="pulse-record-mark"><Icon name={iconFor(item)} /></div>
              <div className="pulse-record-body">
                <header>
                  <div className="pulse-record-labels">
                    <span className={`pulse-category pulse-category-${item.category}`}>{categoryLabel(item.category)}</span>
                    <span className="pulse-source">{item.source === 'chain' ? 'chain receipt' : 'keeper decision'}</span>
                    {item.status && <span className="pulse-status">{item.status}</span>}
                  </div>
                  <time dateTime={item.timestamp} title={formatUtc(item.timestamp)}>{timeAgo(item.timestamp)}</time>
                </header>

                <div className="pulse-record-copy">
                  <strong>{item.action}</strong>
                  {item.quantity && <span>{item.quantity}{item.key_symbol ? ` $${item.key_symbol}` : ''}</span>}
                  {item.agent_id !== null && item.agent_name && (
                    <a href={performancePath(item.agent_id)}>{item.agent_name} <small>#{item.agent_id}</small></a>
                  )}
                </div>

                {item.value && item.value !== '0' && (
                  <div className="pulse-value">{item.value} {item.value_symbol}</div>
                )}
                {item.reason && <p className="pulse-reason">{item.reason}</p>}

                <footer>
                  <div className="pulse-people">
                    {item.actor && (
                      <span>actor <a href={creatorPath(item.actor)}>{item.actor_handle ? `@${item.actor_handle}` : shortenAddress(item.actor)}</a></span>
                    )}
                    {item.creator && item.creator.toLowerCase() !== item.actor?.toLowerCase() && (
                      <span>creator <a href={creatorPath(item.creator)}>{item.creator_handle ? `@${item.creator_handle}` : shortenAddress(item.creator)}</a></span>
                    )}
                  </div>
                  {item.tx_hash ? (
                    <a className="pulse-receipt" href={`${explorerUrl}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">
                      receipt <Icon name="arrow" />
                    </a>
                  ) : (
                    <span className="pulse-no-receipt"><Icon name="pause" />No transaction signed</span>
                  )}
                </footer>
              </div>
            </article>
          </div>
        )
      })}
    </div>
  )
}

function iconFor(item: PulseItem): 'spark' | 'wallet' | 'clock' | 'layers' | 'key' | 'receipt' {
  if (item.category === 'keys') return 'key'
  if (item.category === 'keeper') return 'clock'
  if (item.category === 'range') return 'layers'
  if (item.category === 'reserve') return 'receipt'
  if (item.category === 'muppet') return 'spark'
  return 'wallet'
}

function categoryLabel(category: PulseItem['category']): string {
  if (category === 'muppet') return 'launch'
  if (category === 'range') return 'range'
  if (category === 'keys') return 'Agent Key'
  if (category === 'reserve') return 'Stock Token reserve'
  return category
}

function utcDay(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'time unavailable'
  const today = new Date()
  const sameDay = date.getUTCFullYear() === today.getUTCFullYear()
    && date.getUTCMonth() === today.getUTCMonth()
    && date.getUTCDate() === today.getUTCDate()
  if (sameDay) return 'Today, UTC'
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function timeAgo(value: string): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'time unavailable'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

export function formatUtc(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)
}
