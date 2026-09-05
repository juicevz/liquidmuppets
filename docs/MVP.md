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
- token address: not supplied; runtime configuration is required

The gate fails closed. An empty address, invalid contract, RPC failure or balance below the threshold cannot launch through the app.

The current mainnet factory was deployed before this rule and does not check `$MUPPETS` itself. A technically capable user can call that factory directly. Unbypassable protocol-level utility requires a gated factory migration after the canonical token is deployed. Until then, this is an app and API access rule.

## Current deployment

- chain: Robinhood Chain mainnet, ID `4663`
- deployment block: `52653314`
- factory: `0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460`
- policy executor: `0x948c21BAC4eB147a0c5Cd8E722fb49dD7eCc7fAc`
- Key marketplace: `0x255573d6Cb2F8Ebb73677f6Ab9b3D98c2458B2cb`
- fee RWA reserve: `0xF10DA007314bB3e7B34FE06bB5c590190dcE9765`
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

This choice is enabled so creators can launch and fund the full product shape, but the adapter only isolates WETH by vault. It cannot swap, lend, bridge, enter a token pool, or send funds to an administrator. It produces no yield. A `$MUPPETS` pool cannot be configured until the canonical token address and initial liquidity terms are supplied.

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

## User flow

1. Browse agents, markets and documentation without connecting a wallet or holding `$MUPPETS`.
2. Connect an EVM wallet on Robinhood Chain mainnet.
3. Hold at least `100,000 $MUPPETS` to unlock agent launch through the app.
4. Pick any of the seven pet appearances.
5. Select stable yield, ETH range, or launch reserve.
6. Confirm the deployed market for that task.
7. Set the Agent Key name, symbol, fixed whole-Key supply, and first ask.
8. Sign the factory transaction. The factory deploys an Agent Key and capped ERC-4626 StrategyVault, registers its policy, and opens the first listing.
9. Approve and deposit the task asset. The wallet receives transferable vault shares.
10. The creator or private keeper requests the task cycle. PolicyExecutor enforces the route and limits before the vault can call its immutable adapter.
11. Depositors can redeem their shares. Full redemption recalls the complete adapter position and pays the assets actually realized.
12. Key holders can buy, list, bid, sell, or permanently bind whole Keys through the native marketplace.
13. Every filled Key trade sends its 3% fee to the Stock Token reserve. The private keeper executes a purchase after the threshold and cooldown checks pass.

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
- `FeeRwaReserve` receives marketplace fees, enforces route and oracle checks, rotates purchases, and holds the purchased Stock Tokens.

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

All three have live asks of 20 Keys at 0.001 ETH per Key, one bound Key, and a live 5-Key dev bid at 0.0008 ETH per Key. These records are labeled through the `@liquidmuppets_dev` app handle. No circular self-trades were added.

The dev-funded liquidity activation also deposited 0.05 WETH into the range vault, converted 0.01 WETH into USDG for the stable vault, allocated both strategies to their policy targets, and made the first reserve purchase.

## Backend data flow

The API reads deployment configuration from environment variables and validates chain connectivity on startup. Thin routes delegate to services that:

- verify `$MUPPETS` launch eligibility against the canonical token contract
- query factory, vault, Key, marketplace, and adapter state through RPC
- return live fee-reserve totals, holdings, limits, and all 26 routes
- decode public activity logs and enrich them with agent metadata
- cache the activity response briefly to avoid repeated wide log scans
- issue short-lived profile challenges and verify signed claims
- expose strategy parameters and transaction previews without signing them
- relay only allowlisted read-only JSON-RPC methods for the browser
- validate that the encrypted keeper key derives to A5 and that A5 is allowed by both keeper contracts before any scheduled signing
- check all live vaults and the fee reserve every five minutes, record every decision, and sign only executable actions

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

forge test --match-contract FeeRwaReserveForkTest \
  --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```

The Morpho fork test allocates and redeems canonical USDG. The EZManager fork test deposits WETH, opens a real range, advances time, atomically recenters, and fully redeems. The reserve fork test buys AAPL through the live WETH, USDG, and Stock Token pools with the onchain oracle minimum.

## Launch readiness

The existing-agent loop is operational as a controlled mainnet beta: deposits, bounded strategy cycles, withdrawals, Key asks, bids, partial fills, binding, public activity, scheduled keeper checks, and the Stock Token reserve are live. New creator launches are intentionally locked until the canonical `$MUPPETS` address is configured.

Before an unrestricted public launch:

- the canonical `$MUPPETS` contract address has not been supplied, so app launch is currently locked for every wallet
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
