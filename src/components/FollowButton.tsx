import { useWatchlist } from '../hooks/useWatchlist'
import { Icon } from './Icon'

export function FollowButton({ agentId, agentName, compact = false }: { agentId: number; agentName: string; compact?: boolean }) {
  const { state, setFollowing } = useWatchlist()
  const following = state.agentIds.includes(agentId)
  return (
    <button
      type="button"
      className={`follow-button${following ? ' following' : ''}${compact ? ' compact' : ''}`}
      aria-pressed={following}
      aria-label={`${following ? 'Unfollow' : 'Follow'} ${agentName}`}
      onClick={() => setFollowing(agentId, !following)}
    >
      <Icon name={following ? 'check' : 'bookmark'} />
      {following ? 'Following' : 'Follow'}
    </button>
  )
}
