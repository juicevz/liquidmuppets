# LiquidMuppets mainnet MVP

LiquidMuppets combines two separate products on Robinhood Chain mainnet:

1. a task-bound ERC-4626 vault where depositors own transferable shares
2. a fixed-supply Agent Key market for trading and permanent binding

A third token has platform access utility. Public browsing remains open, but a creator must hold at least `15,000 $MUPPETS` in the connected wallet to launch a new agent through the LiquidMuppets app. The token remains in the wallet and is not spent, locked or burned.

A qualifying creator chooses one of seven cosmetic pets, assigns one of three enabled tasks, chooses that task's live market, sets the Key supply and initial ask, and signs the factory transaction. The selected task fixes the deposit asset, adapter, allocation cap, cooldown, and vault cap. Pet appearance never changes the financial behavior.

## $MUPPETS access gate

- gated feature: launching a new Muppet through `/app/create`
- minimum balance: `15,000 $MUPPETS`
- public without the token: landing, docs, marketplace, activity, Muppet performance, creator profiles, System Pulse, watchlists, Market Radar and portfolio reads
- balance verification: FastAPI reads `balanceOf(wallet)` from Robinhood Chain; the browser checks again before sending the first transaction
- token address: `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`

The gate fails closed. An empty address, invalid contract, RPC failure or balance below the threshold cannot launch through the app.

The current mainnet factory was deployed before this rule and does not check `$MUPPETS` itself. A technically capable user can call that factory directly. Unbypassable protocol-level utility requires a gated factory migration after the canonical token is deployed. Until then, this is an app and API access rule.

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

## Three task configurations

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

Capital is aggregated only inside an exact asset address, symbol and decimals group. Different assets are never converted or summed. Agent Key state is returned with each Muppet but rendered in a separate speculative-market section because Key prices do not enter vault accounting.

A claimed app handle is displayed as a wallet-signed label. It does not verify an external social account. A wallet without a handle or launched Muppet still has a valid public address page with an honest empty state.

### System Pulse

`/app/pulse` is backed by `GET /api/v1/pulse`. The service merges decoded chain activity with keeper-run records, sorts them by exact UTC timestamp and exposes filters for category, creator, Muppet and result limit.

- a decoded chain event keeps its transaction hash and block number
- a keeper action with the same transaction hash enriches that chain event with the recorded reason and status instead of creating a duplicate
- a keeper hold remains a decision-only record with its reason and no transaction receipt
- range actions, vault activity, Agent Key speculation and Stock Token reserve purchases remain separately labeled and filterable
- creator filtering follows the Muppet creator, so deposits or keeper actions for that creator's vault remain on the creator record even when another wallet was the immediate actor

The chain decoder refreshes at most once per minute during normal operation and caches immutable agent metadata, token symbols and event-block timestamps. Retryable RPC failures receive bounded retries. A recent successful snapshot is reported as `cached` without a page-level warning; it becomes `stale` after five minutes and remains visibly labeled until a refresh succeeds. Persisted keeper decisions remain available throughout.

### Watchlists and Muppet Market Radar

`/app/watchlist` is the public Monitor route. Follow and unfollow controls appear in the marketplace performance table and on every public Muppet performance page. Versioned browser storage keeps only public Muppet IDs and the alert read-through timestamp. No wallet connection, signature, API account or contract transaction is required. Clearing the browser's site data removes that local state.

The Alerts view derives warnings from recorded evidence for followed Muppets and from System Pulse. It covers out-of-range positions, blocked or unavailable market health, delayed market-evidence refreshes, explicitly aged or unavailable oracles, keeper actions and holds, deposits, withdrawals, allocations, Agent Key activity and protocol-wide Stock Token reserve purchases. A transaction-backed action links to its receipt. Keeper holds and market observations keep their no-transaction boundary explicit.

The Market Radar beta is read-only. `GET /api/v1/market-radar` groups the latest recorded adapter evidence by configured task route and returns `live`, `review`, or `rejected` with the exact reason. It exposes the exact pool or Morpho market, native liquidity evidence, oracle boundary, policy capacity, protocol fee and maximum slippage when available. The current adapters do not expose 24 hour volume, pool age, realized execution cost or an expected-return model. Those values remain `not exposed` or `not applicable`; the app does not derive USD liquidity, historical APY or projected yield. Radar cannot approve a route or move capital.

## User flow

1. Browse agents, markets, public creator profiles, System Pulse, watchlists, Market Radar and documentation without connecting a wallet or holding `$MUPPETS`.
2. Connect an EVM wallet on Robinhood Chain mainnet.
3. Hold at least `15,000 $MUPPETS` to unlock agent launch through the app.
4. Pick any of the seven pet appearances.
5. Select stable yield, ETH range, or launch reserve.
6. Confirm the deployed market for that task.
7. Set the Agent Key name, symbol, fixed whole-Key supply, and first ask.
8. Confirm vault and Key creation, Key approval, and the first ask. The browser records each submitted receipt so an interrupted launch can resume at the first unfinished step.
9. Use the post-launch command center to preview the exact ERC-4626 shares, approve the task asset, and fund the vault. The wallet receives transferable vault shares.
10. The creator or private keeper requests the task cycle. PolicyExecutor enforces the route and limits before the vault can call its immutable adapter.
11. Depositors can redeem their shares. Full redemption recalls the complete adapter position and pays the assets actually realized.
12. Key holders can buy, list, bid, sell, or permanently bind whole Keys through the native marketplace.
13. Every filled Key trade sends its 3% fee to the Stock Token reserve. The private keeper executes a purchase after the threshold and cooldown checks pass.

The browser signs and submits user transactions through the injected wallet. The FastAPI service reads public state and metadata. It does not custody funds or hold the deployer key. Launch recovery stores only public inputs, addresses, statuses and transaction hashes in the current browser, scoped to the connected wallet, chain and factory.

### Post-launch command center

Once the three launch receipts confirm, `/app/create` immediately exposes the new vault's funding controls, its `previewDeposit` result, the connected wallet's task-asset balance, an estimate for the next five minute keeper check, the public performance link and an X share action. The preview comes from the deployed ERC-4626 contract and can change with vault state before execution. Keeper timing is an estimate from the latest recorded decision; each check can still act or hold under policy.

If creation, approval or listing is interrupted, `Resume launch` first checks any saved submitted transaction. It sends only the first missing or reverted stage. Browser storage is a convenience rather than a cross-device ledger, so clearing site data removes that local recovery record while the onchain receipts remain authoritative.

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

- verify `$MUPPETS` launch eligibility against the canonical token contract
- query factory, vault, Key, marketplace, and adapter state through RPC
- return live fee-reserve totals, holdings, limits, and all 26 routes
- decode public activity logs and enrich them with agent metadata
- cache the activity response briefly to avoid repeated wide log scans
- assemble public creator profiles from persisted performance summaries without summing unlike assets
- merge keeper decisions with matching chain receipts for the filtered System Pulse feed
- compile read-only Market Radar route states from persisted adapter summaries without triggering new chain reads
- issue short-lived profile challenges and verify signed claims
- expose strategy parameters and transaction previews without signing them
- relay only allowlisted read-only JSON-RPC methods for the browser
- validate that the encrypted keeper key derives to A5 and that A5 is allowed by both keeper contracts before any scheduled signing
- check all live vaults and the fee reserve every five minutes, record every decision, and sign only executable actions

SQLite stores public profile claims, challenges, and keeper-run metadata. A claimed handle is normalized and unique. Challenges expire after 10 minutes and cannot be reused.

Launch recovery and the post-launch command state are frontend-only. They are not added to SQLite and do not add a custodial backend path.

Failure handling is explicit: RPC or decode failures return an API error, activity polling shows a reconnecting state, contract transactions surface wallet errors, and policy or adapter checks revert the whole onchain action.

`GET /api/v1/access/{wallet}` returns the token address, required amount, live balance and eligibility decision. Access verification fails closed when token configuration or RPC reads are unavailable.

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

forge test --match-contract FeeRwaReserveForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```

The Morpho fork test allocates and redeems canonical USDG. The EZManager fork test deposits WETH, opens a real range, advances time, atomically recenters, and fully redeems. The reserve fork test buys AAPL through the live WETH, USDG, and Stock Token pools with the onchain oracle minimum.

## Launch readiness

The controlled mainnet beta is operational: qualifying creator launches, deposits, bounded strategy cycles, withdrawals, Key asks, bids, partial fills, binding, public activity, scheduled keeper checks, and the Stock Token reserve are live. The app and API unlock creator launch when the connected wallet holds at least `15,000 $MUPPETS`.

Before an unrestricted public launch:

- the canonical `$MUPPETS` contract is configured in the app and API, with unavailable reads still failing closed
- the existing factory does not enforce the token rule against direct contract calls; a gated factory migration is required if the rule must be unbypassable
- mainnet deposits use real assets and carry loss risk
- contracts are tested but not independently audited
- the current owner is a dedicated EOA rather than a multisig; it can pause `FeeRwaReserve` and rescue reserve assets while paused
- source verification for the current deployment is pending
- public keeper triggering is disabled; the host-encrypted A5 key is installed, both onchain allowlists are active, and scheduled checks run every five minutes
- stable yield can be zero and can become temporarily illiquid
- the range route has execution, LP, pricing, smart-contract, and impermanent-loss risk
- the launch route currently stages WETH and generates no yield
- Stock Token routes can lose liquidity, pause, or hold stale prices; the contract skips those routes but cannot remove market risk
- Stock Token availability and restrictions depend on jurisdiction; legal review is required for the intended launch audience
- task and deposit caps reduce exposure but do not make any route safe or guaranteed
