# LIQUIDMUPPETS

LIQUIDMUPPETS is a Robinhood Chain mainnet marketplace for policy-bounded onchain agents. Public browsing remains open. Launching a new agent through the app requires at least `15,000 $MUPPETS` in the connected wallet.

The `$MUPPETS` balance is reusable access utility. It remains in the wallet and is not spent, locked or burned. The canonical Robinhood Chain token is `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`. The existing factory predates the rule and remains directly callable; a gated factory migration is required for protocol-level enforcement.

Public interface: [https://liquidmuppets.io](https://liquidmuppets.io)

X: [@AMBF](https://x.com/AMBF)

Current status: controlled mainnet beta. Existing Muppets can be funded, allocated, traded and redeemed. New creator launches are available through the app to connected wallets holding at least `15,000 $MUPPETS`. If that rule must be enforced by the protocol rather than only the app and API, the current factory must also be replaced with a gated version.

## Live mainnet scope

- Robinhood Chain ID `4663`
- seven cosmetic pet appearances, independent from task permissions
- three selectable task configurations
- one deployed money route for each task, with no unavailable route cards in the app
- native Agent Key asks, bids, partial fills, buys, sells and permanent binding
- 3% marketplace fee routed into an onchain Stock Token reserve
- 26 oracle-bounded Stock Token purchase routes
- public activity built from contract logs
- a shareable public performance URL for every Muppet, backed by five minute checkpoints
- a performance marketplace with health, tracked change, deployment, oracle and keeper evidence plus two-Muppet comparison
- a shareable creator profile for every wallet, with Muppets, per-asset vault totals, performance evidence and receipts
- System Pulse, a unified public feed for decoded receipts and recorded keeper actions or holds
- a post-launch command center with vault funding, an onchain share preview, keeper timing, performance link and X sharing
- browser-local recovery for the three launch transactions, keyed to the connected wallet, chain and factory
- optional app handles claimed with a wallet signature and no gas
- app and API balance gate requiring `15,000 $MUPPETS` to launch a new agent
- canonical `$MUPPETS` token configured at `0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189`
- no deployer key in the browser, API, or VPS; the limited keeper key is accepted only through the host-encrypted vault and loaded only by the private service

The routes are deliberately different:

| Task | Deposit and share | Live behavior | Main cap |
| --- | --- | --- | --- |
| Stable yield | USDG to mUSDG | Supplies up to 90% to one immutable Morpho Blue USDe / USDG market | 10,000 USDG |
| ETH range | WETH to mETH | Converts WETH through the canonical WETH / USDG 0.01% pool and opens a separately accounted EZManager range | 1 WETH |
| Launch pool | WETH to mLAUNCH | Isolates up to 10% as a WETH reserve while no launch-token pool is approved | 0.25 WETH |

Stable yield and ETH range are active venue strategies. Launch pool is selectable and functional as a staging reserve, but it does not yet trade, lend, bridge, enter a token pool, collect fees, or generate yield. Its smaller allocation is a truthful boundary, not a volume gate.

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

creator receives a fixed Agent Key supply
  -> creator opens the first ask
  -> lowest active ask becomes the floor
  -> users buy, list, bid, sell, or permanently bind whole Keys
  -> 3% fee applies only when value changes hands
  -> fee enters FeeRwaReserve as native ETH
  -> private keeper converts ETH to USDG after the 0.0001 ETH threshold
  -> reserve buys the next eligible Stock Token and holds it onchain
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

## Public activity

`GET /api/v1/activity` scans the deployed contracts from the current deployment block and returns real launches, asks, bids, fills, deposits, withdrawals, allocations, recalls, recenters, and Key bindings. The marketplace polls this endpoint and links every item to its transaction.

- green: buys, deposits, launches and strategy allocations
- red: sells, withdrawals and recalls
- neutral: asks and bids before a fill

`POST /api/v1/profiles/challenge` and `POST /api/v1/profiles/claim` let a wallet claim an app handle with an EIP-191 signature. The signature proves control of that wallet. It does not verify an X account or any other external identity.

`GET /api/v1/access/{wallet}` checks launch eligibility against the configured `$MUPPETS` token on Robinhood Chain. Missing configuration, unreadable contract state and insufficient balance all fail closed.

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

Every wallet has a public creator route at `/app/creator/{wallet}`. The corresponding `GET /api/v1/creators/{wallet}` response lists every recorded Muppet launched by that address, its checkpoint count, performance summary, receipt count and separate Agent Key market. Vault totals are grouped by contract asset and decimals. USDG, WETH and any future assets are never summed into a fabricated portfolio value.

The profile shows a wallet-signed app handle when one exists. The handle proves control of that wallet only. A profile with no claimed handle remains address-native, and a wallet with no recorded Muppets returns an honest empty profile rather than a generated history.

`GET /api/v1/pulse` merges two evidence sources into one reverse-chronological record:

- decoded mainnet events for launches, deposits, withdrawals, allocations, recalls, range actions, Agent Key orders and fills, binding, and Stock Token purchases
- SQLite keeper decisions, including actions and holds with the policy reason that produced each decision

When a keeper transaction matches a decoded chain receipt, Pulse shows one event enriched with the keeper reason instead of duplicating it. A hold has no transaction link and says no transaction was signed. The endpoint supports `category`, `creator`, `agent_id`, and `limit` filters. Agent Key records remain visibly separate from vault performance, and Stock Token reserve activity remains its own category.

The chain decoder refreshes at most once per minute during normal operation and caches immutable agent metadata, token symbols and event-block timestamps instead of rereading them on every visitor request. Rate limits and other retryable RPC failures get bounded retries. A recent successful snapshot is reported as `cached` without a page-level alert; it becomes `stale` after five minutes and remains visibly labeled until a refresh succeeds.

## Launch recovery and command center

The launch flow records each submitted transaction hash before waiting for confirmation: vault and Key creation, Key approval, then the first ask. If the wallet rejects a later step, a transaction reverts, confirmation reading times out, or the page reloads, `/app/create` restores the matching browser-local record and offers `Resume launch`. Resume checks any existing receipt before it sends the first missing transaction, so it does not blindly create another Muppet or repeat a pending listing.

This recovery record is scoped to the chain ID, factory address and connected wallet. It contains the public launch inputs, contract addresses and transaction hashes only. It contains no signature, private key or token approval secret, and it does not move automatically to another browser or device.

After all three receipts confirm, the same page becomes the post-launch command center. It:

- reads `previewDeposit` from the deployed ERC-4626 vault and shows the exact expected shares before funding
- shows the connected wallet's live task-asset balance, then submits the asset approval and vault deposit through that wallet
- estimates the next five minute keeper check from the latest recorded decision, while stating that policy can still act or hold
- links directly to the Muppet's public performance page, vault, Agent Key and launch receipts
- opens a prepared X share intent for the public performance URL

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
forge test --match-contract FeeRwaReserveForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```

The fork suites enter and redeem the current Morpho route, open, atomically recenter, and redeem a current EZManager range, and buy an oracle-bounded AAPL Stock Token through the live reserve route.

## Deployment

The deployer key must be dedicated and injected only at runtime. It must never be committed or copied into a frontend variable.

```bash
cd contracts
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com -vvv
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast -vvv
```

The frontend uses atomic release directories under `/var/www/liquidmuppets/releases/` with `/var/www/liquidmuppets/current` as the active symlink. The API runs as the unprivileged `liquidmuppets` user from `/opt/liquidmuppets-api/current`, reads public runtime values from `/etc/liquidmuppets/api.env` and `/etc/liquidmuppets/runtime-public.env`, reads the keeper secret only from mode-0600 `/etc/liquidmuppets/keeper.env`, and writes profiles, keeper decisions, performance checkpoints, and marketplace performance summaries to SQLite under `/var/lib/liquidmuppets`. Creator profiles and Pulse are read models over those persisted records plus decoded chain events.

## API

- `GET /api/v1/health`
- `GET /api/v1/contracts`
- `GET /api/v1/rwa-reserve`
- `GET /api/v1/access/{wallet}`
- `GET /api/v1/strategies`
- `POST /api/v1/strategies/preview`
- `GET /api/v1/activity` with optional `agent_id` and `limit` filters
- `GET /api/v1/marketplace/performance`
- `GET /api/v1/agents/{agentId}/performance`
- `GET /api/v1/creators/{wallet}`
- `GET /api/v1/pulse` with optional `category`, `creator`, `agent_id`, and `limit` filters
- `POST /api/v1/profiles/challenge`
- `POST /api/v1/profiles/claim`
- `GET /api/v1/profiles/{wallet}`
- `POST /api/v1/keeper/run`
- `POST /api/v1/keeper/rwa/run`
- `GET /api/v1/keeper/runs`

Public keeper triggering is disabled. The production scheduler is active every five minutes. It validates that its encrypted key derives to A5 and that A5 is authorized by both `PolicyExecutor` and `FeeRwaReserve`, records skipped decisions, and signs only when an action passes the current policy and route checks.

## Risk boundary

- `$MUPPETS` launch access is enforced by the app and API, not the current factory contract
- app launch fails closed if the canonical `$MUPPETS` contract or its Robinhood Chain balance read is unavailable
- interrupted launch recovery is stored only in the current browser; users should keep wallet receipts if they switch devices or clear site data
- an unbypassable 15,000 `$MUPPETS` rule requires a gated factory migration because the current factory predates the rule
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
- per-vault caps reduce exposure but do not make deposits risk-free
