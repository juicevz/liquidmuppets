import { Icon } from './Icon'
import type { TokenAccess } from '../lib/api'

interface CreatorSlotsProps {
  access: TokenAccess | null
  connected?: boolean
  loading?: boolean
  slotSize?: string
  explorerUrl?: string
  tokenAddress?: string | null
}

export function CreatorSlots({
  access,
  connected = true,
  loading = false,
  slotSize = '15000',
  explorerUrl,
  tokenAddress,
}: CreatorSlotsProps) {
  const overCapacity = access?.overCapacity ?? 0
  const status = capacityStatus(access, connected, loading)
  const effectiveSlotSize = access?.slotSize ?? slotSize
  const effectiveAddress = access?.tokenAddress ?? tokenAddress

  return (
    <section className={`creator-slots creator-slots-${status.tone}`} aria-labelledby="creator-slots-title">
      <header>
        <div>
          <span className="creator-slots-kicker"><Icon name="spark" />$MUPPETS capacity</span>
          <h2 id="creator-slots-title">Creator Slots</h2>
        </div>
        <span className="creator-slots-status"><i aria-hidden="true" />{status.label}</span>
      </header>

      <div className="creator-slots-grid">
        <span><small>wallet balance</small><strong>{access?.balance !== null && access?.balance !== undefined ? `${formatToken(access.balance)} $MUPPETS` : connected ? 'unavailable' : 'connect wallet'}</strong></span>
        <span><small>slots unlocked</small><strong>{access?.slotCount ?? '—'}</strong></span>
        <span><small>slots used</small><strong>{access?.slotsUsed ?? '—'}</strong></span>
        <span><small>slots available</small><strong>{access?.slotsAvailable ?? '—'}</strong></span>
        <span><small>next launch threshold</small><strong>{access?.requiredForNextLaunch ? `${formatToken(access.requiredForNextLaunch)} $MUPPETS` : `${formatToken(effectiveSlotSize)} $MUPPETS`}</strong></span>
      </div>

      <div className="creator-slots-copy">
        <p><strong>{formatToken(effectiveSlotSize)} $MUPPETS per slot.</strong> One slot supports one launched Muppet and one featured placement. Tokens stay liquid in the wallet.</p>
        <p>{overCapacity > 0
          ? `${overCapacity} Muppet${overCapacity === 1 ? ' is' : 's are'} over current capacity. Existing vaults, withdrawals and Agent Key markets remain available.`
          : 'A lower balance only pauses additional launches and any featured placement above current capacity.'}</p>
      </div>

      <footer>
        <span>{access?.enforcement === 'onchain' ? 'onchain enforced' : 'app + API enforced'}</span>
        {access?.nextSlotThreshold && <span>next balance slot at {formatToken(access.nextSlotThreshold)} $MUPPETS</span>}
        {effectiveAddress && explorerUrl && (
          <a href={`${explorerUrl}/address/${effectiveAddress}`} target="_blank" rel="noreferrer" aria-label={`MUPPETS contract ${effectiveAddress}`}>
            CA {effectiveAddress} <Icon name="arrow" />
          </a>
        )}
      </footer>
    </section>
  )
}

function capacityStatus(access: TokenAccess | null, connected: boolean, loading: boolean): { label: string; tone: string } {
  if (loading) return { label: 'checking wallet', tone: 'pending' }
  if (!connected) return { label: 'connect to check', tone: 'pending' }
  if (!access || access.reason === 'access_check_unavailable') return { label: 'read unavailable', tone: 'pending' }
  if (access.reason === 'token_not_configured') return { label: 'not configured', tone: 'pending' }
  if ((access.overCapacity ?? 0) > 0) return { label: `${access.overCapacity} over capacity`, tone: 'limited' }
  if (access.eligible) return { label: `${access.slotsAvailable} available`, tone: 'ready' }
  if (access.reason === 'capacity_full') return { label: 'capacity full', tone: 'limited' }
  return { label: 'no active slots', tone: 'limited' }
}

function formatToken(value: string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value
  return numeric.toLocaleString('en-US', { maximumFractionDigits: 6 })
}
