# LIQUIDMUPPETS

LIQUIDMUPPETS is a Robinhood Chain mainnet marketplace for policy-bounded onchain agents. A Muppet is an onchain vault with one job: pick a cosmetic pet, choose one live vault route, then launch and fund it. Public browsing remains open. Every `15,000 $MUPPETS` held unlocks one active Creator Slot. One available slot permits one new Muppet and one featured Muppet on the creator profile. FactoryV2 also counts $MUPPETS deliberately locked in an Agent Bond.

Creator Slots currently equal `floor(wallet balance / 15,000)`. After the verified FactoryV2 and Agent Bond activation, the formula becomes `floor((liquid balance + bonded balance) / 15,000)`. Tokens remain transferable unless a holder deliberately opens a fixed 30, 90, or 180 day Agent Bond position. If capacity falls, existing vaults, withdrawals and Agent Key markets remain available; only additional launches and over-capacity featured placement pause. The canonical Robinhood Chain token is `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`.

Public interface: [https://liquidmuppets.io](https://liquidmuppets.io)

Full product explainer: [https://liquidmuppets.io/about](https://liquidmuppets.io/about)

X: [@AMBF](https://x.com/AMBF)

Current status: controlled mainnet beta. Existing Muppets can be funded, allocated, traded and redeemed. Creator Slots are live in the app and API. The live V1 launch path is app and API enforced. FactoryV2, the exact-Key marketplace, Revenue Router, Agent Bond, buyback executor and five-year vesting vault are implemented and tested in this repository but have not been broadcast to mainnet. The public pages report that activation boundary and do not report rewards or buybacks as live.

## Live mainnet scope

- Robinhood Chain ID `4663`
- seven cosmetic pet appearances, independent from task permissions
- a three-stage beginner creator for pet and name, one of three live jobs, then launch and funding
- four FactoryV2 review candidates kept in Market Radar and documentation instead of the launch picker
- one deployed money route for each job, with no unavailable route cards in the beginner launch flow
- native Agent Key asks, bids, partial fills, buys, sells and permanent binding
- 3% marketplace fee routed into an onchain Stock Token reserve
- 26 oracle-bounded Stock Token purchase routes
- public activity built from contract logs
- a shareable public performance URL for every Muppet, backed by five minute checkpoints
- a performance marketplace with health, tracked change, deployment, oracle and keeper evidence plus two-Muppet comparison
- a shareable creator profile for every wallet, with Muppets, per-asset vault totals, performance evidence and receipts
- live Creator Slot balance, used, available, next-threshold and featured-placement state on launch and creator pages
- System Pulse, a unified public feed for decoded receipts and recorded keeper actions or holds
- automatic Proof Cards with durable public URLs for meaningful protocol records
- browser-local Muppet watchlists with an in-app evidence alert inbox
- Muppet Market Radar, a read-only view of approved route health, capacity, source gaps and exact status reasons
- a public Revenue Engine page with the current Pons configuration, target fee path, activation checks, contract totals, wallet bond-position state and receipts since deployment
- a post-launch command center with vault funding, an optional separate Agent Key listing, an onchain share preview, keeper timing, performance link and X sharing
- browser-local recovery for the single creation receipt and optional Key listing receipts, keyed to the connected wallet, chain and factory
- optional app handles claimed with a wallet signature and no gas
- app and API capacity gate requiring one available slot per new launch through the current V1 interface
- FactoryV2 code with one onchain creator slot per 15,000 `$MUPPETS`, reviewed task registry, risk presets, multisig-only ownership and a post-verification launch switch
- Revenue Router, Agent Bond and KeyMarketplaceV2 contracts with exact Key attribution, completed weekly reward epochs, a seven day maturation period, fixed 30, 90 and 180 day positions, and one permanently bound Key per unit
- a fork-tested Pons v4 `$MUPPETS` buyback executor plus a paused, Safe-owned vault that caps keeper execution and vests every purchased lot for five years
- canonical `$MUPPETS` token configured at `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`
- no deployer key in the browser, API, or VPS; the limited keeper key is accepted only through the host-encrypted vault and loaded only by the private service

The routes are deliberately different:

| Task | Deposit and share | Live behavior | Main cap |
| --- | --- | --- | --- |
| Stable yield | USDG to mUSDG | Supplies up to 90% to one immutable Morpho Blue USDe / USDG market | 10,000 USDG |
| ETH range | WETH to mETH | Converts WETH through the canonical WETH / USDG 0.01% pool and opens a separately accounted EZManager range | 1 WETH |
| Launch pool | WETH to mLAUNCH | Isolates up to 10% as a WETH reserve while no launch-token pool is approved | 0.25 WETH |

Stable yield and ETH range are active venue strategies. Launch pool is selectable and functional as a staging reserve, but it does not yet trade, lend, bridge, enter a token pool, collect fees, or generate yield. Its smaller allocation is a truthful boundary, not a volume gate.

FactoryV2 also carries a review catalog for the next route set:

| Candidate | Exact route | Candidate cap | Evidence now | Activation boundary |
| --- | --- | ---: | --- | --- |
| AAPL / USDG | Uniswap 0.05% pool `0xAae0…2d6D` | 2,500 USDG | exact pool and oracle identified | EZManager does not currently approve the pool |
| NVDA / USDG | Uniswap 0.05% pool `0xd4EB…14a3` | 2,500 USDG | venue allowlisted; open, allocate and full redemption passed on a mainnet fork | FactoryV2 source verification and Safe approval |
| SPY / USDG | Uniswap 0.05% pool `0xa7Bb…9167` | 2,500 USDG | exact pool and oracle identified | EZManager does not currently approve the pool |
| screened meme / WETH | no pool selected | 1,000 USDG | hard liquidity, age, volume, oracle and exit criteria are defined | an exact asset and pool must pass review |

Review candidates cannot be launched. They are displayed so the missing evidence is public instead of being represented as a live strategy.

## Public roadmap

The live site publishes the work in four evidence-based phases. `Shipped` means live or published. Every later item remains conditional on source verification, Safe approval, independent review, or venue evidence. There are no invented dates, completion percentages, or historical APY claims.

| Phase | State | Work |
| --- | --- | --- |
| 01 · Market core | shipped | public performance and creator pages; `$MUPPETS` Creator Slots; automatic Proof Cards; System Pulse; watchlists, alerts and Market Radar; public Revenue Engine and exact-Key revenue pages; tested epoch-based router, bond, marketplace and buyback package; three live task routes and the 26-route Stock Token reserve |
| 02 · Resilience | next | independent production RPC fallback; source verification; verified Safe ownership; independent contract review; deploy and verify the Revenue Router, Agent Bond, KeyMarketplaceV2 and buyback vault; configure the Pons buyback and creator fee recipient |
| 03 · Permissioning | conditional | simulate and broadcast FactoryV2 after Safe approval; enforce one creator slot per 15,000 liquid or Agent-Bonded `$MUPPETS` onchain; preserve V1 positions and markets; enable launches through a separate Safe transaction |
| 04 · Asset expansion | conditional | activate NVDA/USDG only after verified FactoryV2 activation; retain AAPL/USDG and SPY/USDG as disabled venue candidates; keep meme/WETH disabled until every route gate passes; expose new market evidence only when adapters source it |

The sequence can change when evidence changes. The website and this repository use the same roadmap boundaries.

## Deployed contracts

Current deployment block: `52653314`.

- `LiquidMuppetsFactory`: [`0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460`](https://robinhoodchain.blockscout.com/address/0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460)
- `PolicyExecutor`: [`0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc`](https://robinhoodchain.blockscout.com/address/0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc)
- `KeyMarketplace`: [`0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb`](https://robinhoodchain.blockscout.com/address/0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb)
- `FeeRwaReserve`: [`0xF10DA007314bB3e7B34FE06bB5c590190dcE9765`](https://robinhoodchain.blockscout.com/address/0xF10DA007314bB3e7B34FE06bB5c590190dcE9765)
- `MorphoBlueAdapter`: [`0x169EfD23f67811709C0Db823f7c82fcF2732781d`](https://robinhoodchain.blockscout.com/address/0x169EfD23f67811709C0Db823f7c82fcF2732781d)
- `EZManagerRangeAdapter`: [`0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d`](https://robinhoodchain.blockscout.com/address/0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d)
- `LaunchReserveAdapter`: [`0x956127B0B586B9427182FCd9325efe032E9B5181`](https://robinhoodchain.blockscout.com/address/0x956127B0B586B9427182FCd9325efe032E9B5181)

The deployer and current owner are the dedicated address `0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f`. The limited keeper is `0xA5960A69E57F4EbC924503bC829f1E6670BfBA51`. Marketplace treasury payments now go directly to `FeeRwaReserve`. Deployment receipts and runtime bytecode were checked through RPC. Source verification for this deployment is still pending. The retired zero-agent deployment is preserved in `contracts/deployments/robinhood-mainnet-v1.json`.

### FactoryV2 migration package

`LiquidMuppetsFactoryV2` preserves the V1 agent ID range, delegates legacy reads to V1, and deploys only new vaults and Keys. It counts legacy and V2 Muppets, then requires `(existing Muppets + 1) × 15,000 $MUPPETS` for the next launch. Its access balance adds the liquid wallet balance and the exact amount held by `MuppetAgentBond`. Its public `creatorSlotState` view returns the combined access balance, unlocked slots, used slots, available slots and the next-launch requirement. FactoryV2 also exposes defensive, balanced and active policy presets. Each task points to an exact asset, immutable adapter, route ID, deposit cap and allowed preset mask.

The deployment script creates a separate KeyMarketplaceV2, Agent Bond, Revenue Router, Pons v4 buyback executor, five-year vesting buyback vault and the fork-tested NVDA/USDG adapter. It switches only future policy registration to V2 and transfers every protocol owner role to a Safe with at least two owners and a threshold of at least two. Existing V1 vault deposits, allocations, redemptions and Key orders retain their original contracts. The frontend aggregates both Key markets after migration.

FactoryV2 launches default to off. They can only be enabled by deployed governance code after Blockscout source verification. No FactoryV2 address is listed here because no migration transaction has been broadcast. The current optimized FactoryV2 runtime is also above the EIP-170 deployment limit, so its creation logic must be split or reduced and the migration simulation repeated before broadcast. The Revenue Router, Agent Bond, KeyMarketplaceV2 and buyback contracts remain below that limit.

## Assets and venues

- canonical USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- canonical WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Morpho Blue: `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`
- USDe / USDG market: `0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6`
- EZManager wrapper: `0x6F81790Ebac25497be379Dc66143fb298663Ae11`
- WETH / USDG 0.01% pool: `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`
- swap router: `0xCaf681a66D020601342297493863E78C959E5cb2`

## Money and Key paths

```text
task asset
  -> StrategyVault
  -> transferable ERC-4626 shares to depositor
  -> creator or private keeper requests a bounded strategy cycle
  -> PolicyExecutor checks authorization, pause, expiry, cooldown and caps
  -> the task's immutable adapter executes
  -> vault accounting reads idle assets plus adapter position value

current factory creates a fixed Agent Key supply with the Muppet
  -> no Key is approved or listed during launch
  -> creator can optionally approve a chosen quantity after launch
  -> creator can then open the first ask
  -> lowest active ask becomes the floor
  -> users buy, list, bid, sell, or permanently bind whole Keys
  -> 3% fee applies only when value changes hands
  -> fee enters FeeRwaReserve as native ETH
  -> private keeper converts ETH to USDG after the 0.0001 ETH threshold
  -> reserve buys the next eligible Stock Token and holds it onchain

verified revenue migration
  -> the external Pons protocol keeps 0.300% of each $MUPPETS trade
  -> the enabled Pons buyback receives 0.350% and follows its five-year vest
  -> 2.350% creator revenue enters MuppetRevenueRouter
  -> 50% becomes WETH rewards for eligible Agent Bond weight in the latest completed weekly epoch
  -> 30% enters FeeRwaReserve and 20% funds keeper and operating costs
  -> one base unit requires 15,000 bonded $MUPPETS and one unused bound Agent Key
  -> positions mature for 7 days, then earn only for full completed epochs
  -> fixed terms are 30 days at 1x, 90 days at 1.25x, or 180 days at 1.5x

V2 Agent Key fill
  -> KeyMarketplaceV2 sends the settled fee, gross volume and exact Key to MuppetRevenueRouter
  -> 50% becomes WETH rewards only for epoch-eligible Agent Bonds using that exact Key
  -> 25% funds a bounded $MUPPETS market buy through the graduated Pons v4 pool
  -> each purchased lot stays in the Safe-owned vault and vests for five years
  -> 15% enters FeeRwaReserve and 10% funds operating costs
  -> legacy marketplace fees stay in the global 50/30/20 lane because the old transfer has no Key address
```

Vault shares own the capital claim. Agent Keys are a separate market and access asset. A Key cannot redeem vault assets, and its market price does not change vault share value.

## Strategy controls

Stable yield has a 90% allocation limit, 30 minute cooldown, minimum Morpho supply check, maximum 95% utilization check, and nonzero oracle check. Withdrawals depend on available Morpho liquidity.

ETH range has an 85% allocation limit and 6 hour cooldown. The adapter uses an onchain EZManager valuation, a fixed range width of 1,200 ticks on each side, and up to 3% swap and LP execution slippage. EZManager currently charges 0.4% on entry. The creator can recall the position or atomically close and reopen it around the current tick. A failed reopen reverts the preceding close.

Launch reserve has a 10% allocation limit and 30 minute cooldown. Accounting is isolated by vault and the adapter can only hold and return WETH. It has no administrator withdrawal path.

Full vault redemption recalls the complete adapter position and pays the assets actually realized. This prevents residual adapter dust from being treated as redeemable value, but it does not prevent market loss or venue illiquidity.

## Stock Token fee reserve

The fee reserve rotates across 26 enabled Robinhood Stock Token routes: AAPL, AMD, AMZN, ASML, BABA, CRCL, DELL, GME, GOOGL, INTC, META, MSFT, MSTR, MU, NVDA, PLTR, QQQ, SGOV, SLV, SNDK, SPCX, SPY, TSLA, TSM, USAR, and USO.

Each route uses a direct USDG pool and a Robinhood Chain Chainlink feed. A cycle skips disabled routes, empty pool liquidity, paused token oracles, nonpositive or incomplete feed rounds, and prices older than three days. Execution uses a 3% maximum slippage bound, a 0.0001 ETH threshold, a 0.01 ETH per-cycle cap, and a 30 minute cooldown.

The first dev-funded cycle spent `0.01 ETH`, routed `24.587800 USDG`, and bought `0.076456289003050387 AAPL`. It is recorded separately from marketplace fees. Stock Tokens are tokenized debt securities and do not grant shareholder rights in the underlying company.

## Revenue Engine and Agent Bonds

`MuppetRevenueRouter` keeps two accounting lanes. Pons creator revenue and legacy Key fees use the existing permissionless weekly 50/30/20 route: 50% WETH to eligible Agent Bond weight in the latest completed epoch, 30% to the Stock Token reserve and 20% to operations. Each KeyMarketplaceV2 fill calls the router with its exact Key, gross volume and fee. That Key's permissionless weekly route sends 50% as WETH only to eligible bonds using the same Key, 25% to the `$MUPPETS` buyback vault, 15% to the Stock Token reserve and 10% to operations. Direct funding remains separate from revenue.

`MuppetAgentBond` requires `15,000 $MUPPETS` and one unused, permanently bound Agent Key per base unit. It accepts Keys only from approved LiquidMuppets marketplaces. Every bond is a separate non-transferable position with an immutable term: 30 days at `1x`, 90 days at `1.25x`, or 180 days at `1.5x`. A position first matures for seven days, then contributes its fixed weight only to full weekly epochs that begin after maturation and end before unlock. A late bond cannot claim a previously completed epoch. Longer terms change distribution weight, not the amount of real revenue in the reward pot.

Unbonding returns the position's `$MUPPETS` after its fixed unlock and releases that Key commitment, but cannot reverse the Key contract's permanent bind. Bonded `$MUPPETS` continue to count toward FactoryV2 Creator Slots. Global and exact-Key WETH remain in separate epoch ledgers, and claims are bounded to one position with at most 25 eligible weekly epochs. There are no token emissions, automatic compounding, early exits, transferable bond receipts, or invented APY.

`PonsV4MuppetsBuybackExecutor` was exercised against the live graduated `$MUPPETS` pool on a Robinhood Chain fork. It requires a nonzero minimum output and a deadline no more than five minutes away. `MuppetBuybackVault` holds each Key's native budget, limits execution to an approved keeper, caps one purchase at `0.01 ETH`, enforces a 30 minute per-Key cooldown and vests every purchased lot to the Safe over five years. Price-sensitive execution is intentionally keeper-limited because the Pons pool does not expose an independent token oracle. Routing and the public receipt ledger remain permissionless.

The target route for the external 3% `$MUPPETS` trade fee is exact:

| Destination | Effective trade fee |
| --- | ---: |
| Pons protocol | 0.300% |
| Pons built-in buyback and five-year vest | 0.350% |
| Agent Bond WETH rewards | 1.175% |
| LiquidMuppets Stock Token reserve | 0.705% |
| keeper and operations | 0.470% |

The current Pons buyback is still off and its creator-fee recipient does not point to the undeployed router. `/app/revenue` reads those values from chain and keeps the release labeled `activation pending`. Every `/app/muppet/{agentId}` page has a separate Key revenue section. Legacy Muppets say `global only`; V2 pages read exact volume, fees, committed units, eligible epoch weight, WETH per `1x` unit for the latest completed epoch, `$MUPPETS` bought and receipts from `GET /api/v1/revenue/keys/{key}`. Tracking begins at the V2 deployment block. Nothing is backfilled or annualized.

## Public activity

`GET /api/v1/activity` incrementally indexes the deployed contracts and returns real launches, asks, bids, fills, deposits, withdrawals, allocations, recalls, recenters, and Key bindings. The indexer starts at the deployment block once, persists decoded events and its next safe block in SQLite, then reads only the new confirmed range plus a short reorg window. The marketplace polls the persisted snapshot and links every item to its transaction.

- green: buys, deposits, launches and strategy allocations
- red: sells, withdrawals and recalls
- neutral: asks and bids before a fill

`POST /api/v1/profiles/challenge` and `POST /api/v1/profiles/claim` let a wallet claim an app handle with an EIP-191 signature. The signature proves control of that wallet. It does not verify an X account or any other external identity.

`GET /api/v1/access/{wallet}` reads the configured liquid `$MUPPETS` balance, optional Agent-Bonded balance and factory creator IDs on Robinhood Chain. It returns slot size, slots unlocked, used and available, funded featured placements, over-capacity count, and both the next balance-slot and next-launch thresholds. Missing token or factory configuration and unreadable contract state fail closed.

## Public performance pages

Every onchain Muppet has a public route at `/app/muppet/{agentId}`. The page records and displays:

- ERC-4626 share price and total vault assets at an exact block
- deployed and idle assets
- cumulative deposits and withdrawals observed after the first checkpoint
- cash-flow-adjusted asset change since tracking began
- the immutable adapter, asset, venue, market or pool, and exact active range when one exists
- current market health inputs and an explicit oracle timestamp boundary
- the latest recorded keeper action or hold, its reason, and its transaction receipt when one was signed
- decoded vault events with explorer receipts
- Agent Key market state in a separate section because Keys do not own vault assets

The first checkpoint is the baseline. The service does not reconstruct a pretend pre-launch curve and does not publish historical or annualized APY. The cash-flow-adjusted change is `current assets + withdrawals - deposits - opening assets`; its percentage uses opening assets plus recorded deposits as tracked capital. This is a transparent change measure, not a time-weighted return or promised yield.

Checkpoints are stored in SQLite every five minutes. Deposit and withdrawal totals advance from ERC-4626 events emitted between consecutive checkpoint blocks. Chart history is downsampled only for the response and always preserves the first and latest checkpoint.

The marketplace reads a lightweight recorded summary for every Muppet and shows its cash-flow-adjusted change, deployed percentage, market health, oracle timestamp boundary, and latest keeper decision with its reason. Any two Muppets can be selected for a side-by-side comparison. Each column keeps the original asset, exact tracking start, and observed window visible. The app does not convert unlike assets into a common score, equalize different periods, or infer an annualized return.

`GET /api/v1/marketplace/performance` serves the last successful summaries from SQLite, so a slow upstream RPC cannot blank the marketplace. The five minute recorder refreshes each summary from an exact checkpoint and current adapter evidence. The payload exposes both checkpoint capture time and market observation time; a failed refresh leaves the older timestamp visible rather than presenting stale evidence as fresh.

## Public creator profiles and System Pulse

Every wallet has a public creator route at `/app/creator/{wallet}`. The corresponding `GET /api/v1/creators/{wallet}` response lists every recorded Muppet launched by that address, its checkpoint count, performance summary, receipt count and separate Agent Key market. It also returns the wallet's live Creator Slot calculation and the IDs receiving funded featured placement. The newest Muppets fill those placements deterministically. Vault totals are grouped by contract asset and decimals. USDG, WETH and any future assets are never summed into a fabricated portfolio value.

The profile shows a wallet-signed app handle when one exists. The handle proves control of that wallet only. A profile with no claimed handle remains address-native, and a wallet with no recorded Muppets returns an honest empty profile rather than a generated history.

`GET /api/v1/pulse` merges two evidence sources into one reverse-chronological record:

- decoded mainnet events for launches, deposits, withdrawals, allocations, recalls, range actions, Agent Key orders and fills, binding, and Stock Token purchases
- SQLite keeper decisions, including actions and holds with the policy reason that produced each decision

When a keeper transaction matches a decoded chain receipt, Pulse shows one event enriched with the keeper reason instead of duplicating it. A hold has no transaction link and says no transaction was signed. The endpoint supports `category`, `creator`, `agent_id`, and `limit` filters. Agent Key records remain visibly separate from vault performance, and Stock Token reserve activity remains its own category.

The chain decoder refreshes in the background at most once per minute during normal operation and caches immutable agent metadata, token symbols and event-block timestamps instead of rereading them on every visitor request. Rate limits and other retryable RPC failures get bounded retries. A recent successful snapshot is reported as `cached` without a page-level alert; it becomes `stale` after five minutes and remains visibly labeled until a refresh succeeds.

Activity events, scan progress and the last healthy fee-reserve response survive API restarts in SQLite. Chain, activity and browser read-relay requests use the configured ordered RPC pool and move to the next endpoint on transport, rate-limit or upstream failures. Robinhood's public endpoint is rate-limited and is not represented as an independent fallback; production should set `RPC_FALLBACK_URLS` to one or more separately operated provider endpoints.

## Automatic Muppet Proof Cards

`/app/proofs` turns recorded protocol evidence into durable, shareable cards. A card is materialized for each Muppet launch, first vault deposit, keeper action, range change, whole-percentage flow-adjusted NAV milestone since tracking began, Agent Key fill and Stock Token reserve purchase. Routine keeper holds are grouped into one summary per Muppet per UTC day so five-minute checks do not bury meaningful activity.

Each record stores the Muppet, creator, asset, exact pool or market, latest labeled market-health observation, event timestamp, reason, receipt state and canonical `$MUPPETS` address. Transaction-backed actions link to their receipt. Keeper holds and checkpoint milestones explicitly say that no transaction was signed. Agent Key fills remain separate from vault ownership and performance.

The public share page is `/proof/{proofId}`. It renders its own title, description and social-card metadata on the server, links back to `/app/proof/{proofId}`, and exposes a generated 1200 by 630 PNG at `/api/v1/proofs/{proofId}/card.png`. An inspectable SVG is also available at `/api/v1/proofs/{proofId}/card.svg`. Proof rows persist in SQLite, so their IDs and URLs survive API restarts. Flow-adjusted milestones advance only when a recorded whole-percentage high-water mark is crossed. They are not APY, are never annualized, and do not reconstruct history before the first checkpoint.

## Watchlists, alerts and Muppet Market Radar

`/app/watchlist` is a public Monitor surface with three views: Watchlist, Alerts and Market Radar. A visitor can follow or unfollow a Muppet from the marketplace performance table or its public performance page. Followed IDs and the alert read-through time are stored only in that browser. No wallet, signature, backend account or contract write is involved, and clearing site data resets the list.

The alert inbox combines two existing evidence sources for followed Muppets: recorded market observations and System Pulse. It calls out blocked or unavailable market health, an out-of-range position, a delayed market-evidence refresh, an unavailable or explicitly aged oracle, keeper actions or holds, deposits, withdrawals, allocations, Agent Key activity and protocol-wide Stock Token reserve purchases. A chain action links to its receipt. A keeper hold says no transaction was signed. A market observation says it has no receipt.

Muppet Market Radar is read-only. `GET /api/v1/market-radar` compiles the three live routes and four FactoryV2 review candidates from the latest recorded adapter summaries. Each route receives one explicit state:

- `live`: the latest usable adapter evidence passed the configured route checks
- `review`: the route is missing current evidence or still awaits protocol approval
- `rejected`: a recorded hard route or accounting check failed

Radar reports exact pool or market identifiers, native route liquidity, oracle evidence, per-vault capacity and policy fee or slippage limits when those fields exist. Current adapters do not expose 24 hour volume, pool age, realized execution cost or an expected return model, so those fields remain `not exposed` or `not applicable`. Radar never fills those gaps with historical APY, USD conversions or projected yield, and it cannot approve or execute a route.

## Launch recovery and command center

The creator is intentionally split into three stages: pet and name, one live job, then launch and fund. Launch submits one factory transaction that creates the Muppet, vault and the fixed-supply Agent Key required by the current factory. It does not approve or list Keys. The app records the creation hash before waiting for confirmation. If confirmation reading times out or the page reloads, `/app/create` restores the matching browser-local record and offers `Resume launch`. Resume checks the existing receipt before it can send anything, so it does not blindly create another Muppet.

This recovery record is scoped to the chain ID, factory address and connected wallet. It contains the public launch inputs, contract addresses and transaction hashes only. It contains no signature, private key or token approval secret, and it does not move automatically to another browser or device.

After the creation receipt confirms, the same page becomes the post-launch command center. It:

- reads `previewDeposit` from the deployed ERC-4626 vault and shows the exact expected shares before funding
- shows the connected wallet's live task-asset balance, then submits the asset approval and vault deposit through that wallet
- estimates the next five minute keeper check from the latest recorded decision, while stating that policy can still act or hold
- links directly to the Muppet's public performance page, vault, Agent Key and launch receipts
- opens a prepared X share intent for the public performance URL
- keeps the speculative Agent Key market closed unless the creator separately approves a chosen Key quantity and creates a listing; those two receipts are resumable and displayed apart from the launch receipt

The share preview is a current onchain conversion, not a promised return. The public performance page still begins at its first recorded checkpoint and does not invent earlier APY.

## Seeded mainnet state

Three developer fixtures exercise each task without demo data:

- `morpho frog`, stable yield, with a funded and allocated USDG vault
- `range fox`, ETH range, with a real EZManager position
- `launch sage`, launch reserve, with an isolated WETH allocation

Each has a live 20-Key ask at `0.001 ETH` per Key, one permanently bound Key, and a live 5-Key dev bid at `0.0008 ETH` per Key. These are clearly developer-created fixtures. No self-buy or circular resale was broadcast to manufacture trading activity.

## Repository

```text
frontend:  src/                React 19, TypeScript, Vite, viem
backend:   backend/            FastAPI, web3.py, SQLite, pytest
contracts: contracts/          Solidity, Foundry, OpenZeppelin, Morpho Blue
ops:       deploy/             Nginx and systemd templates
qa:        qa/                 browser and transaction tests
```

## Local setup

```bash
npm install
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cp .env.example .env
```

Run the API:

```bash
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Run the frontend from the repository root:

```bash
npm run dev
```

To test the local frontend against the public read-only API without sending wallet transactions:

```bash
LIQUIDMUPPETS_API_PROXY=https://liquidmuppets.io npm run dev
```

The app opens at `http://127.0.0.1:4317`. OpenAPI is available at `http://127.0.0.1:8000/api/docs`.

Browser chain reads use `/api/v1/rpc`, a same-origin relay that allowlists read-only JSON-RPC methods. Wallet signing and transaction submission stay inside the injected wallet provider.

## Verification

```bash
npm run check
npm run qa:fork # with the documented local mainnet fork, API, and Vite server running
cd backend
.venv/bin/ruff check app tests
.venv/bin/mypy app
.venv/bin/pytest -q
cd ../contracts
forge fmt --check
forge build
forge test -vv
forge test --match-contract MorphoBlueAdapterForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
forge test --match-contract EZManagerRangeAdapterForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
forge test --match-contract EZManagerPoolAdapterForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
forge test --match-contract FeeRwaReserveForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
forge test --match-contract PonsV4MuppetsBuybackExecutorForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```

The fork suites enter and redeem the current Morpho route, open, atomically recenter, and redeem the current WETH range, exercise a full NVDA/USDG deposit and exit through the new reviewed adapter, buy an oracle-bounded AAPL Stock Token through the live reserve route, and execute a real `$MUPPETS` buy through its graduated Pons v4 pool.

## Deployment

The deployer key must be dedicated and injected only at runtime. It must never be committed or copied into a frontend variable.

```bash
cd contracts
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com -vvv
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast -vvv
```

FactoryV2 migration is intentionally a separate operation. `SAFE_MULTISIG` must be deployed Safe-compatible code with at least two owners and a threshold of at least two. Run the first command without `--broadcast`, inspect the simulated ownership and legacy-path assertions, then broadcast only after the Safe address and migration window are approved:

```bash
cd contracts
SAFE_MULTISIG=0x... forge script script/DeployFactoryV2.s.sol:DeployFactoryV2 \
  --rpc-url https://rpc.mainnet.chain.robinhood.com -vvv

WRITE_DEPLOYMENT_RECEIPT=true SAFE_MULTISIG=0x... forge script script/DeployFactoryV2.s.sol:DeployFactoryV2 \
  --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast -vvv

./scripts/verify-factory-v2.sh deployments/robinhood-mainnet-v2.json
```

The migration receipt is written with `deployed-pending-verification`. The verification script checks all seven migration contracts, confirms Safe ownership, confirms launches and revenue contracts are still disabled, and prints the Pons creator and Safe activation calldata. Update the API runtime addresses only after deployment, verification, Safe control and the external Pons transactions confirm.

The frontend uses atomic release directories under `/var/www/liquidmuppets/releases/` with `/var/www/liquidmuppets/current` as the active symlink. The API runs as the unprivileged `liquidmuppets` user from `/opt/liquidmuppets-api/current`, reads public runtime values from `/etc/liquidmuppets/api.env` and `/etc/liquidmuppets/runtime-public.env`, reads the keeper secret only from mode-0600 `/etc/liquidmuppets/keeper.env`, and writes profiles, keeper decisions, performance checkpoints, marketplace performance summaries and Proof Cards to SQLite under `/var/lib/liquidmuppets`. Set `PUBLIC_BASE_URL` to the public origin used in durable proof, image and app URLs. Creator profiles, Pulse and Proof Cards are read models over persisted records plus decoded chain events.

## API

- `GET /api/v1/health`
- `GET /api/v1/contracts`
- `GET /api/v1/rwa-reserve`
- `GET /api/v1/revenue` with an optional `wallet` query
- `GET /api/v1/access/{wallet}`
- `GET /api/v1/strategies`
- `POST /api/v1/strategies/preview`
- `GET /api/v1/activity` with optional `agent_id` and `limit` filters
- `GET /api/v1/marketplace/performance`
- `GET /api/v1/market-radar`
- `GET /api/v1/agents/{agentId}/performance`
- `GET /api/v1/creators/{wallet}`
- `GET /api/v1/pulse` with optional `category`, `creator`, `agent_id`, and `limit` filters
- `GET /api/v1/proofs` with optional `kind`, `creator`, `agent_id`, and `limit` filters
- `GET /api/v1/proofs/{proofId}`
- `GET /api/v1/proofs/{proofId}/card.png`
- `GET /api/v1/proofs/{proofId}/card.svg`
- `GET /proof/{proofId}` for the server-rendered public share page
- `POST /api/v1/profiles/challenge`
- `POST /api/v1/profiles/claim`
- `GET /api/v1/profiles/{wallet}`
- `POST /api/v1/keeper/run`
- `POST /api/v1/keeper/rwa/run`
- `GET /api/v1/keeper/runs`
- `GET /api/v1/revenue`
- `GET /api/v1/revenue/keys/{key}`

Public keeper triggering is disabled. The production scheduler is active every five minutes. It validates that its encrypted key derives to A5 and that A5 is authorized by both `PolicyExecutor` and `FeeRwaReserve`, records skipped decisions, and signs only when an action passes the current policy and route checks.

## Risk boundary

- `$MUPPETS` Creator Slots are enforced by the app and API, not the currently deployed V1 factory contract
- app launch fails closed if the canonical `$MUPPETS` balance or factory creator-count read is unavailable
- interrupted launch recovery is stored only in the current browser; users should keep wallet receipts if they switch devices or clear site data
- FactoryV2 implements an unbypassable one-slot-per-15,000 `$MUPPETS` rule, but its current runtime exceeds the EIP-170 size limit and must be reduced before the multisig migration can be broadcast, verified and enabled
- Agent Bonds, KeyMarketplaceV2, the Revenue Router and the buyback vault are implemented and tested but not live until the verified Safe migration, independent review and separate Pons creator transactions complete
- binding an Agent Key is permanent; each 30, 90, or 180 day `$MUPPETS` position is reversible only after its fixed unlock timestamp
- Agent Bond positions mature for seven days and earn only for full completed epochs; `1x`, `1.25x` and `1.5x` are distribution weights, not promised returns
- WETH rewards depend entirely on recorded revenue and can be zero; no APY is promised or projected
- only KeyMarketplaceV2 can provide exact-Key fee attribution; legacy Key fees remain global and are never estimated per Muppet
- buybacks have market, keeper and execution risk; the limited keeper supplies the minimum output, each purchase is capped at 0.01 ETH, and purchased `$MUPPETS` vest for five years
- contracts are tested but not independently audited
- stable APY is variable and can be zero
- Morpho withdrawals depend on market liquidity
- concentrated liquidity can underperform holding WETH and incurs swap, LP, and impermanent-loss risk
- launch reserve produces no yield and has no approved token-pool route yet
- Stock Token purchases depend on pool liquidity and 24/5 price feeds; stale or paused routes are skipped
- Stock Token availability and restrictions depend on jurisdiction; the app does not determine legal eligibility
- USDG, WETH, USDe, their oracles, Morpho, Uniswap, EZManager, and Robinhood Chain add external risk
- the owner controls task configuration, reserve pause and routes, and marketplace fee settings within contract limits
- while the fee reserve is paused, the owner can rescue its native ETH or held tokens to a chosen receiver
- the current owner is a dedicated EOA, not a multisig
- source verification for the current deployment is still pending
- AAPL/USDG and SPY/USDG remain disabled because their EZManager pools are not currently approved; no meme/WETH pool has been selected
- NVDA/USDG passed the repository's mainnet-fork entry and full-exit test, but remains disabled until the verified FactoryV2 migration and Safe activation
- per-vault caps reduce exposure but do not make deposits risk-free
