# LiquidMuppets mainnet MVP

LiquidMuppets combines two separate products on Robinhood Chain mainnet:

1. a task-bound ERC-4626 vault where depositors own transferable shares
2. a fixed-supply Agent Key market for trading and permanent binding

A third token has platform access utility. Public browsing remains open. Every `15,000 $MUPPETS` in a wallet unlocks one active Creator Slot, and an available slot permits one new Muppet plus one featured placement on the creator profile. After the verified Agent Bond and FactoryV2 activation, deliberately bonded `$MUPPETS` also count toward that capacity while they complete their 30 day lock.

A qualifying creator uses three stages: choose one of seven cosmetic pets and a name, assign one of three enabled jobs, then review the money path and launch. The beginner flow shows only live routes. Four FactoryV2 candidates remain visible in Market Radar and documentation for review, but do not appear as launch choices. The selected job fixes the deposit asset, adapter, allocation cap, cooldown, and vault cap. Pet appearance never changes the financial behavior.

## $MUPPETS Creator Slots

- current capacity formula: `slots = floor(wallet balance / 15,000)`
- post-activation formula: `slots = floor((wallet balance + Agent Bond balance) / 15,000)`
- one available slot permits one new Muppet through `/app/create`
- one used slot funds one featured Muppet on the public creator profile
- public without the token: landing, docs, marketplace, activity, Muppet performance, creator profiles, System Pulse, Proof Cards, watchlists, Market Radar and portfolio reads
- capacity verification: FastAPI reads `balanceOf(wallet)` and `getCreatorAgentIds(wallet)` from Robinhood Chain; the browser checks both again before sending the first transaction
- token address: `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`

The capacity check fails closed. An empty address, invalid contract, unavailable RPC read, or a wallet with no available slot cannot launch through the app. Launch and creator pages show balance, slots unlocked, slots used, slots available and the exact next-launch threshold. The newest Muppets fill currently funded featured placements; every Muppet remains in the complete public ledger.

If a wallet balance falls, existing vaults, deposits, withdrawals, allocations, redemptions and Agent Key markets remain available. The wallet only loses additional launches and featured placement above current capacity.

The current mainnet factory was deployed before this rule and does not check `$MUPPETS` itself. A technically capable user can call that factory directly. FactoryV2 counts legacy and V2 Muppets and requires `(existing Muppets + 1) × 15,000 $MUPPETS` for the next launch. Its access balance combines liquid wallet tokens with tokens deliberately locked in the Agent Bond. Until the published FactoryV2 multisig migration is broadcast, verified and activated, the live V1 path remains an app and API capacity rule.

## Current deployment

- chain: Robinhood Chain mainnet, ID `4663`
- deployment block: `52653314`
- factory: `0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460`
- policy executor: `0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc`
- Key marketplace: `0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb`
- fee RWA reserve: `0xF10DA007314bB3e7B34FE06bB5c590190dcE9765`
- `$MUPPETS` token: `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`
- limited keeper: `0xA5960A69E57F4EbC924503bC829f1E6670BfBA51`
- Morpho adapter: `0x169EfD23f67811709C0Db823f7c82fcF2732781d`
- EZManager range adapter: `0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d`
- launch reserve adapter: `0x956127B0B586B9427182FCd9325efe032E9B5181`

All deployment receipts succeeded and runtime bytecode is present. The marketplace treasury now points to the fee RWA reserve. Source verification for this deployment is pending. The previous zero-agent release remains recorded in `contracts/deployments/robinhood-mainnet-v1.json`.

## FactoryV2 migration and governance

The repository now contains `LiquidMuppetsFactoryV2`, `MuppetRevenueRouter`, `MuppetAgentBond`, a guarded deployment script, an explorer verification script, and V1/V2 frontend and indexer compatibility. No V2, router or bond address is shown in the current deployment list because the migration has not been broadcast.

FactoryV2 adds:

- one immutable creator slot per 15,000 liquid or Agent-Bonded `$MUPPETS`, counting both legacy and V2 Muppets before every new launch
- an owner-controlled registry binding each approved task to an exact asset, adapter, route ID, vault cap and allowed preset mask
- defensive, balanced and active presets for eligible range tasks
- global launch activation that defaults to off and can only be enabled after ownership moves to deployed governance code
- a single global agent ID space that delegates legacy IDs and creator lookups to V1

`DeployFactoryV2.s.sol` requires Safe-compatible code with at least two owners and a threshold of at least two. It creates a separate V2 Key marketplace, Revenue Router, Agent Bond and reviewed NVDA adapter, preserves the V1 marketplace for legacy orders, and switches PolicyExecutor so V1 cannot register new vaults. Existing V1 vault policies, deposits, withdrawals, recalls and redemptions continue against their original contracts. The app and indexer aggregate the legacy and V2 markets without pretending they are one contract.

The migration leaves new launches, revenue routing and new bonding disabled. `scripts/verify-factory-v2.sh` submits all five new contracts to Blockscout, rechecks Safe ownership and paused states, then prints the Pons and Safe calldata needed for activation after review.

## Public roadmap

The site exposes a four-phase roadmap backed by the current release and repository state:

1. `shipped · market core`: public performance and creator pages, `$MUPPETS` Creator Slots, automatic Proof Cards, System Pulse, watchlists, alerts, Market Radar, the public Revenue Engine and tested contract package, three live task routes, and the 26-route Stock Token reserve
2. `next · resilience`: configure an independent production RPC fallback, complete source verification, move protocol ownership to a verified Safe, commission an independent contract review, deploy and verify the Revenue Router and Agent Bond, then configure the Pons buyback and creator fee recipient
3. `conditional · FactoryV2 permissioning`: simulate and broadcast after Safe approval, enforce one creator slot per 15,000 liquid or Agent-Bonded `$MUPPETS` onchain, preserve V1 positions and markets, then enable launches through a separate Safe transaction
4. `conditional · route review`: activate NVDA/USDG only after verified FactoryV2 activation, leave AAPL/USDG and SPY/USDG disabled until venue approval, keep meme/WETH disabled until every liquidity, age, volume, oracle, and exit gate passes, and expose new market evidence only when adapters source it

`Shipped` means live or published. Later work remains conditional on verification and venue evidence. The roadmap has no dates, completion percentages, projected returns, or invented historical APY. Its sequence can change when evidence changes.

## Three live tasks and four reviewed candidates

### Stable yield

- deposit asset: canonical USDG, `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- vault share prefix: `mUSDG`
- route: Morpho Blue USDe collateral / USDG loan market
- market ID: `0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6`
- maximum allocation: 90%
- cooldown: 30 minutes
- vault cap: 10,000 USDG

Before allocation, the adapter checks the exact immutable market ID, a nonzero oracle response, at least 10,000,000 USDG supplied, and utilization no higher than 95%. Borrower interest can change the vault's redemption value. APY is variable and can be zero. Redemption still depends on Morpho liquidity.

### ETH range

- deposit asset: canonical WETH, `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- vault share prefix: `mETH`
- route: EZManager over the canonical Uniswap WETH / USDG 0.01% pool
- pool: `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`
- maximum allocation: 85%
- cooldown: 6 hours
- vault cap: 1 WETH

The adapter converts allocated WETH to USDG, then asks EZManager to open or add to a range extending 1,200 ticks on either side of the current tick. Each vault has separate accounting and a separate position key. Onchain EZManager valuation is converted back to WETH for ERC-4626 accounting.

The creator can recall the position or atomically recenter it. Recenter closes the current position, recalculates the target allocation, and reopens around the current tick in one transaction. If the reopen fails, the entire transaction reverts, including the close.

This route currently allows up to 3% swap and LP execution slippage, and EZManager charges 0.4% on entry. It is concentrated liquidity, not guaranteed yield. It can lose value relative to holding WETH.

### Launch pool

- deposit asset: canonical WETH
- vault share prefix: `mLAUNCH`
- current route: isolated WETH launch reserve
- maximum staged allocation: 10%
- cooldown: 30 minutes
- vault cap: 0.25 WETH

This choice is enabled so creators can launch and fund the full product shape, but the adapter only isolates WETH by vault. It cannot swap, lend, bridge, enter a token pool, or send funds to an administrator. It produces no yield. The canonical `$MUPPETS` address is now known, but a pool route is not configured because no initial liquidity terms or approved adapter migration have been supplied.

There is no platform-volume threshold hiding the route. The restriction is venue safety. The inspected thin pool did not have enough oracle history to justify automated mainnet allocation.

### FactoryV2 route candidates

The candidate templates use the same public evidence model as the live routes. A candidate cannot launch until its exact pool, asset, oracle, adapter, preset mask and cap are approved in FactoryV2.

| Candidate | Deposit asset | Candidate cap | Route status | Current evidence |
| --- | --- | ---: | --- | --- |
| AAPL / USDG | USDG | 2,500 USDG | disabled | exact 0.05% pool and feed identified; EZManager pool approval is currently false |
| NVDA / USDG | USDG | 2,500 USDG | prepared, still disabled | exact 0.05% pool is allowlisted; the dedicated adapter passed a real mainnet-fork open, allocation and full redemption |
| SPY / USDG | USDG | 2,500 USDG | disabled | exact 0.05% pool and feed identified; EZManager pool approval is currently false |
| screened meme / WETH | USDG | 1,000 USDG | unselected and disabled | requires an exact token and pool, at least $250,000 liquidity, 30 days of age, $50,000 24 hour volume, independent fresh price evidence and a tested exit |

`EZManagerPoolAdapter` keeps one immutable pool and oracle per deployment and one separately accounted position key per vault. It checks that EZManager still allows the pool, the pool is not deprecated, and the oracle round is positive, complete and no older than the configured limit before entry. It never blocks an exit on oracle freshness. Full vault redemption closes the position and returns the assets actually realized.

FactoryV2 packages three range-policy choices for routes that allow them:

| Preset | Single action | Daily movement | Maximum deployed | Cooldown |
| --- | ---: | ---: | ---: | ---: |
| defensive | 20% | 30% | 60% | 24 hours |
| balanced | 35% | 50% | 75% | 12 hours |
| active | 50% | 75% | 85% | 6 hours |

Presets are enforceable policy inputs, not return targets. A route can restrict or disable them independently.

## Marketplace fee to Stock Token reserve

`FeeRwaReserve` receives the native ETH fee from every filled Key ask or bid. A purchase cycle wraps the ETH, swaps WETH to USDG through the canonical 0.01% pool, then swaps USDG into the next eligible Robinhood Stock Token. Purchased tokens remain in the reserve contract.

- purchase threshold: `0.0001 ETH`
- maximum purchase cycle: `0.01 ETH`
- cycle cooldown: 30 minutes
- maximum execution slippage: 3%
- route oracle age limit: 3 days, allowing for 24/5 market closures
- route checks: nonzero pool liquidity, `oraclePaused() = false`, positive Chainlink answer, complete round, and age within the route limit
- route order: AAPL, AMD, AMZN, ASML, BABA, CRCL, DELL, GME, GOOGL, INTC, META, MSFT, MSTR, MU, NVDA, PLTR, QQQ, SGOV, SLV, SNDK, SPCX, SPY, TSLA, TSM, USAR, USO

The first dev-funded cycle spent `0.01 ETH`, routed `24.587800 USDG`, and received `0.076456289003050387 AAPL`. This bootstrap is separate from platform fees. `totalFeesReceived` starts at zero and increases only when the marketplace itself pays the reserve.

Robinhood's official assets API returned 194 active Robinhood Chain assets on 2026-09-05, including 191 with fractional market trading. The automatic contract enables 26 routes because those had a matching Robinhood Chain Chainlink feed and a USDG pool holding at least 25,000 USDG during review. The larger catalog is not presented as automatically executable until each route passes the same checks.

Stock Tokens are tokenized debt securities. They do not grant legal or beneficial ownership, voting rights, or shareholder rights in the underlying company. Chainlink prices already incorporate the Stock Token multiplier, so the reserve does not apply `uiMultiplier()` a second time.

## Revenue Engine and Agent Bonds

The public `/app/revenue` page exposes the proposed revenue route, current Pons fee configuration, activation checks, deployed contract totals, wallet reward-unit state and exact transaction receipts since tracking begins. The page is already public. The Revenue Router and Agent Bond are implemented and tested in the repository but are not deployed or active on mainnet. Until verified deployment receipts, Safe ownership and the required Pons configuration transactions agree, the page says `activation pending` and reports no rewards.

One reward unit requires both:

- `15,000 $MUPPETS` locked in `MuppetAgentBond` for 30 days
- one unused Agent Key that its holder has permanently bound

The formula is `reward units = min(floor(bonded MUPPETS / 15,000), committed bound Agent Keys)`. Each bound Key can support only one unit. The `$MUPPETS` become withdrawable after the lock, but the Key binding remains permanent. Bonded `$MUPPETS` continue to count toward FactoryV2 Creator Slots. A Key remains separate from a vault share and provides no claim on vault assets.

The total Pons trade fee remains 3%. The activation target is:

| Destination | Trade value |
| --- | ---: |
| Pons protocol | 0.300% |
| Pons built-in buyback and five-year vest | 0.350% |
| Agent Bond WETH rewards | 1.175% |
| LiquidMuppets Stock Token reserve | 0.705% |
| keeper and operations | 0.470% |

After Pons removes its protocol and buyback portions, `2.350%` creator revenue reaches `MuppetRevenueRouter`. Once per seven days, any account can route that recorded revenue through an immutable `50/30/20` split: 50% wraps into WETH for Agent Bonds, 30% enters the existing Stock Token reserve and 20% goes to the Safe-controlled keeper and operations treasury. Filled Agent Key marketplace fees are recorded as a separate protocol-revenue source and use the same router split.

Direct transfers, treasury top-ups and seeded funds are labeled funding and never enter the reported revenue total. If no reward unit exists, its share stays queued in native ETH. If a week has no recorded revenue, no reward distribution can execute. The contracts create no token emissions and the interface does not calculate an APY.

## Public Muppet performance

Each Muppet has a shareable page at `/app/muppet/{agentId}`. Public performance tracking begins with the first checkpoint recorded after this feature is deployed. The API records another checkpoint every five minutes and never invents a curve for blocks before that baseline.

Each checkpoint binds the following values to one Robinhood Chain block:

- `totalAssets`, `totalSupply`, and `convertToAssets(10 ** shareDecimals)` for NAV and share price
- `deployedAssets` and `idleAssets`
- the vault asset, decimals, share symbol, adapter, and task
- cumulative ERC-4626 deposits and withdrawals emitted after tracking began

The displayed cash-flow-adjusted asset change is:

`current assets + withdrawals - deposits - opening assets`

The displayed percentage divides that change by opening assets plus recorded deposits. This removes simple capital inflows and outflows from the change figure, but it is not a time-weighted return and is not APY.

The same page reads the current route evidence directly from the task adapter. Stable Muppets expose the exact Morpho market ID, supply, borrowing, utilization, and nonzero oracle result. Range Muppets expose the canonical Uniswap pool, active position key, exact opened ticks, current tick, pool allowlist state, liquidity, and valuation result. Launch Muppets expose the isolated reserve balance and state plainly that no pool or oracle is used.

Some adapter oracle interfaces return a value without an update timestamp. In that case, the page says `timestamp not exposed`; it does not label the oracle fresh. The latest keeper record includes the action or hold, reason, time, status, amount, and transaction link when a transaction was actually signed. Deposits, withdrawals, allocations, recalls, and range receipts link to decoded onchain events. The Agent Key market appears in a separate section because Keys have no claim on vault assets.

### Performance marketplace and comparison

The main marketplace exposes the latest recorded performance summary for every Muppet in a dedicated vault table. Each row includes:

- the native vault asset and exact tracking start
- cash-flow-adjusted change since that Muppet's first checkpoint
- deployed capital as a percentage of current vault assets
- current adapter health and its evidence boundary
- oracle age, `timestamp not exposed`, `not used`, or `unavailable`
- the latest keeper action or hold, its reason, and its recorded time

A visitor can select up to two Muppets for a side-by-side comparison. Both columns retain their native asset, checkpoint time, and independently observed tracking window. The comparison does not convert unlike assets, equalize periods, calculate a winner, or invent historical or annualized APY.

`GET /api/v1/marketplace/performance` reads the last successful summaries from SQLite rather than performing a large set of RPC calls during a page request. The five minute checkpoint loop refreshes those rows. Each summary includes separate checkpoint and market-observation timestamps, and a failed refresh preserves the previous timestamp so freshness remains inspectable.

### Public creator profiles

Every creator wallet has a shareable route at `/app/creator/{wallet}` backed by `GET /api/v1/creators/{wallet}`. It lists every Muppet in the recorded marketplace summaries whose factory creator matches that wallet. Each row retains its native asset, checkpoint start, flow-adjusted change, deployed share, market health, checkpoint count and decoded transaction-receipt count.

The same response includes `creator_capacity` and `featured_agent_ids`. Capacity comes from the live canonical `$MUPPETS` balance and factory creator IDs. Featured placement deterministically uses the newest recorded Muppets up to the number of funded slots. A balance drop removes only over-capacity placement; it never removes the full record or changes a vault or Agent Key contract.

Capital is aggregated only inside an exact asset address, symbol and decimals group. Different assets are never converted or summed. Agent Key state is returned with each Muppet but rendered in a separate speculative-market section because Key prices do not enter vault accounting.

A claimed app handle is displayed as a wallet-signed label. It does not verify an external social account. A wallet without a handle or launched Muppet still has a valid public address page with an honest empty state.

### System Pulse

`/app/pulse` is backed by `GET /api/v1/pulse`. The service merges decoded chain activity with keeper-run records, sorts them by exact UTC timestamp and exposes filters for category, creator, Muppet and result limit.

- a decoded chain event keeps its transaction hash and block number
- a keeper action with the same transaction hash enriches that chain event with the recorded reason and status instead of creating a duplicate
- a keeper hold remains a decision-only record with its reason and no transaction receipt
- range actions, vault activity, Agent Key speculation and Stock Token reserve purchases remain separately labeled and filterable
- creator filtering follows the Muppet creator, so deposits or keeper actions for that creator's vault remain on the creator record even when another wallet was the immediate actor

The chain decoder refreshes in the background at most once per minute during normal operation. Its decoded events, order mappings and next confirmed block persist in SQLite, so an API restart resumes from the last healthy point instead of replaying full history. Each refresh reads only new confirmed blocks plus a 12-block reorg window, and contract log requests are chunked. Immutable agent metadata, token symbols and event-block timestamps are cached as well. A recent successful snapshot is reported as `cached` without a page-level warning; it becomes `stale` after five minutes and remains visibly labeled until a refresh succeeds. Persisted keeper decisions remain available throughout.

Chain reads, the activity indexer and the browser's read-only RPC relay share an ordered provider pool. Transport failures, rate limits and retryable upstream JSON-RPC errors move the request to the next configured endpoint. The last healthy fee-reserve response also persists across restarts. Robinhood's public RPC is rate-limited; an independent production fallback must be supplied through `RPC_FALLBACK_URLS` using a provider account or separately operated node.

### Automatic Muppet Proof Cards

`/app/proofs` is the public gallery for persistent evidence cards. The backend creates a card for every Muppet launch, first deposit, keeper action, range change, whole-percentage flow-adjusted NAV milestone since tracking began, Agent Key fill and Stock Token reserve purchase. It combines a close and reopen in the same transaction into one range-change record. Repeated keeper holds are grouped into one card per Muppet per UTC day and update that card's event count.

Each card records the Muppet, creator, native asset, exact pool or market, latest health label and its separate observation time, event timestamp, keeper reason when available, receipt state and canonical `$MUPPETS` address. Chain-backed records link to their transaction. Holds and NAV checkpoints explicitly carry no receipt. Key fills remain visibly separate from vault performance.

The stable public URL is `/proof/{proofId}` and the complete app view is `/app/proof/{proofId}`. The public route renders social metadata server-side and points to a generated 1200 by 630 PNG, with SVG available separately for inspection. Proof rows persist in SQLite so links survive API restarts. A NAV milestone is emitted only when recorded flow-adjusted change crosses a new positive or negative whole-percentage high-water mark. It is neither projected nor annualized APY, and no history is invented before tracking began.

### Watchlists and Muppet Market Radar

`/app/watchlist` is the public Monitor route. Follow and unfollow controls appear in the marketplace performance table and on every public Muppet performance page. Versioned browser storage keeps only public Muppet IDs and the alert read-through timestamp. No wallet connection, signature, API account or contract transaction is required. Clearing the browser's site data removes that local state.

The Alerts view derives warnings from recorded evidence for followed Muppets and from System Pulse. It covers out-of-range positions, blocked or unavailable market health, delayed market-evidence refreshes, explicitly aged or unavailable oracles, keeper actions and holds, deposits, withdrawals, allocations, Agent Key activity and protocol-wide Stock Token reserve purchases. A transaction-backed action links to its receipt. Keeper holds and market observations keep their no-transaction boundary explicit.

The Market Radar beta is read-only. `GET /api/v1/market-radar` groups the latest recorded adapter evidence for three live routes and four FactoryV2 candidates and returns `live`, `review`, or `rejected` with the exact reason. It exposes the exact pool or Morpho market, native liquidity evidence, oracle boundary, policy capacity, protocol fee and maximum slippage when available. The current adapters do not expose 24 hour volume, pool age, realized execution cost or an expected-return model. Those values remain `not exposed` or `not applicable`; the app does not derive USD liquidity, historical APY or projected yield. Radar cannot approve a route or move capital.

## User flow

1. Browse agents, markets, public creator profiles, System Pulse, Proof Cards, watchlists, Market Radar, Revenue Engine and documentation without connecting a wallet or holding `$MUPPETS`.
2. Connect an EVM wallet on Robinhood Chain mainnet.
3. Hold `15,000 $MUPPETS` per Muppet you want to operate. The first launch threshold is 15,000, the second is 30,000, and each later threshold adds 15,000.
4. Pick any of the seven pet appearances and give the Muppet a name.
5. Select stable yield, ETH range, or launch reserve. Open Advanced details only when you need the exact market, checks, or available FactoryV2 preset.
6. Review the deposit asset, deployed maximum, idle minimum, exact market and planned first deposit.
7. Confirm one factory transaction. It creates the Muppet, vault and fixed-supply Agent Key. The browser records the submitted creation receipt so an interrupted launch can resume without creating a duplicate Muppet.
8. Use the post-launch command center to preview the exact ERC-4626 shares, approve the task asset, and fund the vault. The wallet receives transferable vault shares.
9. Optionally open the separate Agent Key market with two confirmations: approve only the chosen Key quantity, then create the listing. A Key has no claim on vault assets or yield.
10. The creator or private keeper requests the task cycle. PolicyExecutor enforces the route and limits before the vault can call its immutable adapter.
11. Depositors can redeem their shares. Full redemption recalls the complete adapter position and pays the assets actually realized.
12. Key holders can buy, list, bid, sell, or permanently bind whole Keys through the native marketplace after a market exists.
13. Before the Revenue Engine activation, every filled Key trade sends its 3% fee directly to the Stock Token reserve. After the verified migration, Key fees enter the Revenue Router and remain separately attributable before the fixed router split executes.
14. After activation, a holder can permanently bind one Agent Key, bond 15,000 `$MUPPETS` for 30 days and claim any WETH assigned to that reward unit from recorded revenue.

The browser signs and submits user transactions through the injected wallet. The FastAPI service reads public state and metadata. It does not custody funds or hold the deployer key. Launch recovery stores only public inputs, addresses, statuses and transaction hashes in the current browser, scoped to the connected wallet, chain and factory.

### Post-launch command center

Once the single creation receipt confirms, `/app/create` immediately exposes the new vault's funding controls, its `previewDeposit` result, the connected wallet's task-asset balance, an estimate for the next five minute keeper check, the public performance link and an X share action. The preview comes from the deployed ERC-4626 contract and can change with vault state before execution. Keeper timing is an estimate from the latest recorded decision; each check can still act or hold under policy.

If creation is interrupted, `Resume launch` first checks the saved factory transaction and only retries after a confirmed revert. The optional Key market has its own saved approval and listing checkpoints, so it can recover without becoming part of launch. Browser storage is a convenience rather than a cross-device ledger, so clearing site data removes that local recovery record while the onchain receipts remain authoritative.

## Policy and contract boundaries

- `LiquidMuppetsFactory` launches agents, deploys vaults and Keys, and binds each vault to one configured task.
- `StrategyVault` provides capped ERC-4626 custody, immutable adapter access, and full-position recall during complete redemption.
- `PolicyExecutor` checks creator or keeper authorization, pause state, expiry, cooldown, per-action cap, daily cap, and total allocation cap.
- `MorphoBlueAdapter` supplies USDG only to the fixed Morpho market and accounts for each vault separately.
- `EZManagerRangeAdapter` controls a separately identified WETH / USDG range for each vault and reports its WETH value.
- `LaunchReserveAdapter` can only receive and return each vault's recorded WETH reserve.
- `AgentKey` is a zero-decimal, fixed-supply ERC-20 used for marketplace transfer and permanent binding.
- `KeyMarketplace` supports native-currency listings, offers, partial fills, and a 3% fee on filled value.
- `FeeRwaReserve` receives marketplace fees, enforces route and oracle checks, rotates purchases, and holds the purchased Stock Tokens.
- `MuppetRevenueRouter` records Pons and Agent Key marketplace revenue separately from outside funding and routes real revenue at most once per seven days.
- `MuppetAgentBond` requires 15,000 `$MUPPETS` and one unused permanently bound Agent Key per reward unit, locks the tokens for 30 days, and accounts for WETH distributions without holder loops.

An Agent Key is not a vault share, debt claim, promised return, or permission to bypass policy. Key price never enters vault accounting.

## Public marketplace tape and System Pulse

The main marketplace includes a public activity rail sourced from contract logs starting at deployment block `52653314`. It shows the signed app handle when one exists and otherwise shows the shortened wallet.

Tracked actions include:

- agent launches and first asks
- new Key asks and bids
- Key buys and sells
- vault deposits and withdrawals
- strategy allocations, range recentering, and recalls
- permanent Key binding

Positive flows such as buys, deposits, launches, and allocations use green values. Negative flows such as sells, withdrawals, and recalls use red values. Unfilled asks and bids remain neutral. Every row links to its transaction receipt.

The compact marketplace rail remains chain-event only. System Pulse expands that evidence into a standalone feed and adds the keeper decisions that do not always emit a transaction, especially holds. The two surfaces use the same decoded action names and wallet profile labels.

The profile challenge flow uses an EIP-191 wallet signature and no gas. It proves wallet control only. It does not verify an external social handle.

## Seeded live fixtures

The developer wallet launched one real agent per task:

- `morpho frog`: funded USDG vault with a Morpho allocation
- `range fox`: funded WETH vault with a live EZManager range
- `launch sage`: funded WETH vault with a staged reserve

All three have live asks of 20 Keys at 0.001 ETH per Key, one bound Key, and a live 5-Key dev bid at 0.0008 ETH per Key. These records are labeled through the `@liquidmuppets_dev` app handle. No circular self-trades were added.

The dev-funded liquidity activation also deposited 0.05 WETH into the range vault, converted 0.01 WETH into USDG for the stable vault, allocated both strategies to their policy targets, and made the first reserve purchase.

## Backend data flow

The API reads deployment configuration from environment variables and validates chain connectivity on startup. Thin routes delegate to services that:

- calculate `$MUPPETS` Creator Slots from the canonical liquid balance, optional Agent Bond balance and the wallet's factory Muppet count
- query factory, vault, Key, marketplace, and adapter state through RPC
- return live fee-reserve totals, holdings, limits, and all 26 routes
- read the live Pons fee policy and expose the Revenue Router, Agent Bond, reward units, source-separated totals, activation checks and receipts without presenting an undeployed route as live
- decode public activity logs and enrich them with agent metadata
- incrementally index confirmed activity into SQLite and rewind a short window for reorg safety
- restore activity and fee-reserve snapshots across API restarts
- fail over read requests across an ordered set of independently configured RPC endpoints
- assemble public creator profiles from persisted performance summaries without summing unlike assets
- merge keeper decisions with matching chain receipts for the filtered System Pulse feed
- materialize durable Proof Cards from persisted events, keeper decisions and checkpoint milestones
- compile read-only Market Radar route states from persisted adapter summaries without triggering new chain reads
- issue short-lived profile challenges and verify signed claims
- expose strategy parameters and transaction previews without signing them
- relay only allowlisted read-only JSON-RPC methods for the browser
- validate that the encrypted keeper key derives to A5 and that A5 is allowed by both keeper contracts before any scheduled signing
- check all live vaults and the fee reserve every five minutes, record every decision, and sign only executable actions

SQLite stores public profile claims, challenges, keeper-run metadata, performance checkpoints, decoded activity, Proof Cards, index progress and last healthy service snapshots. A claimed handle is normalized and unique. Challenges expire after 10 minutes and cannot be reused. `PUBLIC_BASE_URL` supplies the canonical origin for proof, image and app links.

Launch recovery and the post-launch command state are frontend-only. They are not added to SQLite and do not add a custodial backend path.

Failure handling is explicit: RPC or decode failures keep the last healthy timestamp visible, activity polling labels stale state after five minutes, contract transactions surface wallet errors, and policy or adapter checks revert the whole onchain action. A cache is never relabeled as a new chain read.

`GET /api/v1/access/{wallet}` returns the token address, total slot balance, liquid wallet balance, Agent Bond balance, slot size, slots unlocked, slots used, slots available, funded featured placements, over-capacity count, next balance-slot threshold, next-launch threshold and eligibility decision. Access verification fails closed when a configured token, factory, Agent Bond or RPC read is unavailable.

`GET /api/v1/revenue` is public and accepts an optional checksummed or lowercase `wallet` query. It returns the target 3% fee route, current Pons state, deployment and activation checks, source-separated contract totals, receipt history since the configured deployment block and wallet reward-unit state. An upstream Pons read failure is exposed as unavailable evidence rather than converted into a false zero.

## Verification

Run the deterministic suites:

```bash
npm run check

cd backend
.venv/bin/ruff check app tests
.venv/bin/mypy app
.venv/bin/pytest -q

cd ../contracts
forge fmt --check
forge build
forge test -vv
```

Run both venue integrations against current Robinhood mainnet state:

```bash
forge test --match-contract MorphoBlueAdapterForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv

forge test --match-contract EZManagerRangeAdapterForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv

forge test --match-contract EZManagerPoolAdapterForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv

forge test --match-contract FeeRwaReserveForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```

The Morpho fork test allocates and redeems canonical USDG. The current EZManager fork test deposits WETH, opens a real range, advances time, atomically recenters, and fully redeems. The FactoryV2 adapter fork test deposits USDG, opens the allowlisted NVDA/USDG range and fully redeems back to USDG. The reserve fork test buys AAPL through the live WETH, USDG, and Stock Token pools with the onchain oracle minimum.

FactoryV2, Revenue Router and Agent Bond must be simulated before broadcast, then verified before any launch, route or bond switch is enabled:

```bash
cd contracts
SAFE_MULTISIG=0x... forge script script/DeployFactoryV2.s.sol:DeployFactoryV2 \
  --rpc-url https://rpc.mainnet.chain.robinhood.com -vvv

# Add --broadcast only after the Safe, fee route and migration window are approved.
# Set WRITE_DEPLOYMENT_RECEIPT=true only for that approved broadcast.
./scripts/verify-factory-v2.sh deployments/robinhood-mainnet-v2.json
```

## Launch readiness

The controlled mainnet beta is operational: qualifying creator launches, deposits, bounded strategy cycles, withdrawals, Key asks, bids, partial fills, binding, public activity, scheduled keeper checks, and the Stock Token reserve are live. The app and API unlock a creator launch only when the connected wallet has an available Creator Slot.

Before an unrestricted public launch:

- the canonical `$MUPPETS` contract is configured in the app and API, with unavailable reads still failing closed
- the deployed V1 factory does not enforce Creator Slots against direct contract calls; FactoryV2 implements them but its migration has not been broadcast
- mainnet deposits use real assets and carry loss risk
- contracts are tested but not independently audited
- the current owner is a dedicated EOA rather than a multisig; it can pause `FeeRwaReserve` and rescue reserve assets while paused
- source verification for the current deployment is pending
- FactoryV2 requires a verified Safe migration and a separate Safe launch-enable transaction; launches default to off
- the Revenue Router and Agent Bond are implemented and tested but not deployed; both default to paused, require verified Safe ownership and need separate activation transactions
- the current Pons buyback is off and its creator fee recipient does not point to the Revenue Router; no Agent Bond reward can be called live until both settings and the deployed receipt agree
- Revenue Engine rewards are variable WETH distributions from recorded revenue only; there are no emissions, guaranteed payments, backfilled returns or projected APY
- public keeper triggering is disabled; the host-encrypted A5 key is installed, both onchain allowlists are active, and scheduled checks run every five minutes
- stable yield can be zero and can become temporarily illiquid
- the range route has execution, LP, pricing, smart-contract, and impermanent-loss risk
- the launch route currently stages WETH and generates no yield
- NVDA/USDG passed a mainnet-fork open and full exit but remains disabled until FactoryV2 activation
- AAPL/USDG and SPY/USDG are disabled while EZManager approval is false, and the meme/WETH slot has no approved asset or pool
- Stock Token routes can lose liquidity, pause, or hold stale prices; the contract skips those routes but cannot remove market risk
- Stock Token availability and restrictions depend on jurisdiction; legal review is required for the intended launch audience
- task and deposit caps reduce exposure but do not make any route safe or guaranteed
