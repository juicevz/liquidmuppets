# LiquidMuppets mainnet MVP

LiquidMuppets combines two separate products on Robinhood Chain mainnet:

1. a task-bound ERC-4626 vault where depositors own transferable shares
2. a fixed-supply Agent Key market for trading and permanent binding

A third token has platform access utility. Public browsing remains open, but a creator must hold at least `100,000 $MUPPETS` in the connected wallet to launch a new agent through the LiquidMuppets app. The token remains in the wallet and is not spent, locked or burned.

A qualifying creator chooses one of seven cosmetic pets, assigns one of three enabled tasks, chooses that task's live market, sets the Key supply and initial ask, and signs the factory transaction. The selected task fixes the deposit asset, adapter, allocation cap, cooldown, and vault cap. Pet appearance never changes the financial behavior.

## $MUPPETS access gate

- gated feature: launching a new Muppet through `/app/create`
- minimum balance: `100,000 $MUPPETS`
- public without the token: landing, docs, marketplace, activity, agent detail and portfolio reads
- balance verification: FastAPI reads `balanceOf(wallet)` from Robinhood Chain; the browser checks again before sending the first transaction
- token address: pending deployment and runtime configuration

The gate fails closed. An empty address, invalid contract, RPC failure or balance below the threshold cannot launch through the app.

The current mainnet factory was deployed before this rule and does not check `$MUPPETS` itself. A technically capable user can call that factory directly. Unbypassable protocol-level utility requires a gated factory migration after the canonical token is deployed. Until then, this is an app and API access rule.

## Current deployment

- chain: Robinhood Chain mainnet, ID `4663`
- deployment block: `52653314`
- factory: `0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460`
- policy executor: `0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc`
- Key marketplace: `0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb`
- Morpho adapter: `0x169EfD23f67811709C0Db823f7c82fcF2732781d`
- EZManager range adapter: `0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d`
- launch reserve adapter: `0x956127B0B586B9427182FCd9325efe032E9B5181`

All deployment receipts succeeded and runtime bytecode is present. Source verification for this deployment is pending. The previous zero-agent release remains recorded in `contracts/deployments/robinhood-mainnet-v1.json`.

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

This choice is enabled so creators can launch and fund the full product shape, but the adapter currently only isolates WETH by vault. It cannot swap, lend, bridge, enter a token pool, or send funds to an administrator. It produces no yield. A launch-token pool will require a separately reviewed venue and liquidity policy before this task can become active liquidity.

There is no platform-volume threshold hiding the route. The restriction is venue safety. The inspected thin pool did not have enough oracle history to justify automated mainnet allocation.

## Proposed market universe

The launch flow includes a market step after task selection. It distinguishes the current immutable route from markets being evaluated for a future factory version:

- live now: the existing USDG Morpho route, WETH / USDG range, and isolated WETH launch reserve
- Stock Token range candidates: NVDA / USDG, GME / USDG, SPCX / USDG, and SPY / USDG
- Stock Token credit candidate: NVDA collateral with USDG
- company basket candidate: NVDA, MSFT, and GOOGL with independent feeds, weights, drift limits, and caps
- community candidates: a reviewed token paired with WETH or USDG; DOGE, PEPE, and SHIB are watchlist examples rather than approved pools

Every proposed market is labeled `route review`. A user can inspect it, but cannot continue to the Key step or launch it. The current factory accepts only a task ID and permanently binds each vault to one of three global asset and adapter configurations. It does not submit or store the selected proposed market.

A deployable market version requires a new route registry or route ID, an asset-specific adapter, canonical contract verification, valuation-feed and multiplier handling, liquidity and exit-depth checks, route-specific caps, fork tests, and independent review. Stock Tokens provide tokenized exposure and are not shares in the underlying company. Availability can depend on jurisdiction.

## User flow

1. Browse agents, markets and documentation without connecting a wallet or holding `$MUPPETS`.
2. Connect an EVM wallet on Robinhood Chain mainnet.
3. Hold at least `100,000 $MUPPETS` to unlock agent launch through the app.
4. Pick any of the seven pet appearances.
5. Select stable yield, ETH range, or launch reserve.
6. Select the live market for that task. Proposed Stock Token, basket, and community routes can be inspected but not launched.
7. Set the Agent Key name, symbol, fixed whole-Key supply, and first ask.
8. Sign the factory transaction. The factory deploys an Agent Key and capped ERC-4626 StrategyVault, registers its policy, and opens the first listing.
9. Approve and deposit the task asset. The wallet receives transferable vault shares.
10. The creator signs the task cycle. PolicyExecutor enforces the route and limits before the vault can call its immutable adapter.
11. Depositors can redeem their shares. Full redemption recalls the complete adapter position and pays the assets actually realized.
12. Key holders can buy, list, bid, sell, or permanently bind whole Keys through the native marketplace.

The browser signs and submits user transactions through the injected wallet. The FastAPI service reads public state and metadata. It does not custody funds or hold the deployer key.

## Policy and contract boundaries

- `LiquidMuppetsFactory` launches agents, deploys vaults and Keys, and binds each vault to one configured task.
- `StrategyVault` provides capped ERC-4626 custody, immutable adapter access, and full-position recall during complete redemption.
- `PolicyExecutor` checks creator or keeper authorization, pause state, expiry, cooldown, per-action cap, daily cap, and total allocation cap.
- `MorphoBlueAdapter` supplies USDG only to the fixed Morpho market and accounts for each vault separately.
- `EZManagerRangeAdapter` controls a separately identified WETH / USDG range for each vault and reports its WETH value.
- `LaunchReserveAdapter` can only receive and return each vault's recorded WETH reserve.
- `AgentKey` is a zero-decimal, fixed-supply ERC-20 used for marketplace transfer and permanent binding.
- `KeyMarketplace` supports native-currency listings, offers, partial fills, and a 3% fee on filled value.

An Agent Key is not a vault share, debt claim, promised return, or permission to bypass policy. Key price never enters vault accounting.

## Public marketplace tape

The main marketplace includes a public activity rail sourced from contract logs starting at deployment block `52653314`. It shows the signed app handle when one exists and otherwise shows the shortened wallet.

Tracked actions include:

- agent launches and first asks
- new Key asks and bids
- Key buys and sells
- vault deposits and withdrawals
- strategy allocations, range recentering, and recalls
- permanent Key binding

Positive flows such as buys, deposits, launches, and allocations use green values. Negative flows such as sells, withdrawals, and recalls use red values. Unfilled asks and bids remain neutral. Every row links to its transaction receipt.

The profile challenge flow uses an EIP-191 wallet signature and no gas. It proves wallet control only. It does not verify an external social handle.

## Seeded live fixtures

The developer wallet launched one real agent per task:

- `morpho frog`: funded USDG vault with a Morpho allocation
- `range fox`: funded WETH vault with a live EZManager range
- `launch sage`: funded WETH vault with a staged reserve

All three have live asks of 20 Keys at 0.001 ETH per Key and one bound Key. These records are labeled through the `@liquidmuppets_dev` app handle. No circular self-trades were added. Buy and resale behavior is covered by contract tests; a public mainnet trade needs another wallet.

## Backend data flow

The API reads deployment configuration from environment variables and validates chain connectivity on startup. Thin routes delegate to services that:

- verify `$MUPPETS` launch eligibility against the canonical token contract
- query factory, vault, Key, marketplace, and adapter state through RPC
- decode public activity logs and enrich them with agent metadata
- cache the activity response briefly to avoid repeated wide log scans
- issue short-lived profile challenges and verify signed claims
- expose strategy parameters and transaction previews without signing them
- relay only allowlisted read-only JSON-RPC methods for the browser

SQLite stores public profile claims, challenges, and keeper-run metadata. A claimed handle is normalized and unique. Challenges expire after 10 minutes and cannot be reused.

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
```

The Morpho fork test allocates and redeems canonical USDG. The EZManager fork test deposits WETH, opens a real range, advances time, atomically recenters, and fully redeems.

## Launch boundary

- the canonical `$MUPPETS` contract address is not configured, so app launch is currently locked for every wallet
- the existing factory does not enforce the token rule against direct contract calls
- mainnet deposits use real assets and carry loss risk
- contracts are tested but not independently audited
- the current owner and treasury are a dedicated EOA rather than a multisig
- source verification for the current deployment is pending
- there is no automatic mainnet keeper, hidden signer, or backend hot wallet
- stable yield can be zero and can become temporarily illiquid
- the range route has execution, LP, pricing, smart-contract, and impermanent-loss risk
- the launch route currently stages WETH and generates no yield
- task and deposit caps reduce exposure but do not make any route safe or guaranteed
