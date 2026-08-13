import { Icon } from '../components/Icon'
import { getPet } from '../data/pets'
import { useProtocol } from '../hooks/useProtocol'
import { formatAsset, formatEthValue, taskForAgent } from '../lib/protocol'

interface PortfolioPageProps {
  walletAddress?: string
  onConnect: () => void
}

export function PortfolioPage({ walletAddress, onConnect }: PortfolioPageProps) {
  const { config, snapshot, tasks, loading, error, refresh } = useProtocol(walletAddress)
  const address = walletAddress?.toLowerCase()
  const agents = snapshot?.agents ?? []
  const positions = agents.filter((agent) => agent.vault.walletShares > 0n || agent.key.walletBalance > 0n || agent.key.walletBound > 0n)
  const created = agents.filter((agent) => agent.creator.toLowerCase() === address)
  const liquidKeys = positions.reduce((sum, agent) => sum + agent.key.walletBalance, 0n)
  const boundKeys = positions.reduce((sum, agent) => sum + agent.key.walletBound, 0n)

  return (
    <div className="app-page portfolio-page live-portfolio-page">
      <section className="app-page-heading portfolio-heading">
        <div>
          <h1>Your vault shares and Keys.</h1>
          <p>No estimated PnL. Balances, vault assets, asks, and bound access are read directly from contracts.</p>
        </div>
        {walletAddress
          ? <button type="button" className="export-button" onClick={refresh} disabled={loading}><Icon name="spark" />{loading ? 'Reading' : 'Refresh data'}</button>
          : <button type="button" className="export-button" onClick={onConnect}><Icon name="wallet" />Connect wallet</button>}
      </section>

      {error && <div className="protocol-error" role="alert"><Icon name="alert" />{error}</div>}

      <section className="portfolio-overview live-portfolio-overview">
        <div className="portfolio-summary"><span>tracked positions</span><strong>{positions.length}</strong><div><span>from connected wallet</span></div></div>
        <div className="portfolio-stat"><span>liquid Keys</span><strong>{liquidKeys.toString()}</strong><small>transferable or listable</small></div>
        <div className="portfolio-stat"><span>bound Keys</span><strong>{boundKeys.toString()}</strong><small>permanent access record</small></div>
        <div className="portfolio-stat"><span>agents created</span><strong>{created.length}</strong><small>factory records</small></div>
      </section>

      {!walletAddress && <div className="portfolio-connect-empty"><Icon name="wallet" /><h2>Connect your wallet.</h2><p>The app will read its vault shares, USDG, Keys, and created agents.</p><button type="button" onClick={onConnect}>Connect wallet</button></div>}

      {walletAddress && positions.length === 0 && !loading && <div className="portfolio-connect-empty"><Icon name="receipt" /><h2>No positions in this wallet yet.</h2><p>Deposit USDG into a Muppet vault or buy an Agent Key.</p></div>}

      {positions.some((agent) => agent.vault.walletShares > 0n) && (
        <section className="portfolio-agent-table live-position-table">
          <div className="module-head"><span>vault shares</span><small>redeemable claims</small></div>
          <div className="portfolio-table-head"><span>Muppet</span><span>task</span><span>your shares</span><span>vault assets</span><span>deployed</span><span>receipt</span></div>
          {positions.filter((agent) => agent.vault.walletShares > 0n).map((agent) => {
            const pet = getPet(agent.petId)
            const task = taskForAgent(tasks, agent)
            return (
              <div className="portfolio-agent-row" key={agent.id.toString()}>
                <span className="portfolio-agent-name"><img src={pet.portrait} alt="" /><span><strong>{agent.name}</strong><small>{agent.vault.symbol}</small></span></span>
                <strong>{task?.label}</strong>
                <strong>{formatAsset(agent.vault.walletShares, agent.vault.shareDecimals)}</strong>
                <strong>{formatAsset(agent.vault.totalAssets, agent.vault.assetDecimals)} {agent.vault.assetSymbol}</strong>
                <strong>{formatAsset(agent.vault.deployedAssets, agent.vault.assetDecimals)}</strong>
                <a href={`${config?.explorerUrl}/address/${agent.vault.address}`} target="_blank" rel="noreferrer">vault <Icon name="arrow" /></a>
              </div>
            )
          })}
        </section>
      )}

      {positions.some((agent) => agent.key.walletBalance > 0n || agent.key.walletBound > 0n) && (
        <section className="portfolio-key-table live-position-table">
          <div className="module-head"><span>Agent Keys</span><small>market access, never vault ownership</small></div>
          <div className="key-holdings-head"><span>Key market</span><span>liquid</span><span>bound</span><span>floor</span><span>top bid</span><span>contract</span></div>
          {positions.filter((agent) => agent.key.walletBalance > 0n || agent.key.walletBound > 0n).map((agent) => {
            const pet = getPet(agent.petId)
            return (
              <div className="key-holding-row" key={agent.id.toString()}>
                <span className="portfolio-agent-name"><img src={pet.portrait} alt="" /><span><strong>{agent.name}</strong><small>${agent.key.symbol}</small></span></span>
                <strong>{agent.key.walletBalance.toString()}</strong>
                <strong>{agent.key.walletBound.toString()}</strong>
                <strong>{formatEthValue(agent.key.floorWei)}</strong>
                <strong>{formatEthValue(agent.key.topBidWei)}</strong>
                <a href={`${config?.explorerUrl}/address/${agent.key.address}`} target="_blank" rel="noreferrer">Key <Icon name="arrow" /></a>
              </div>
            )
          })}
        </section>
      )}

      {created.length > 0 && (
        <section className="created-agent-list">
          <div className="module-head"><span>created by this wallet</span><small>factory registry</small></div>
          {created.map((agent) => <div key={agent.id.toString()}><img src={getPet(agent.petId).portrait} alt="" /><span><strong>{agent.name}</strong><small>{taskForAgent(tasks, agent)?.label}</small></span><span><small>base ask at launch</small><strong>{formatEthValue(agent.baseFloorWei)}</strong></span></div>)}
        </section>
      )}
    </div>
  )
}
