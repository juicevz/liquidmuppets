# LIQUIDMUPPETS

LIQUIDMUPPETS is a Robinhood Chain mainnet marketplace for policy-bounded onchain agents. A creator picks one of seven cosmetic pets, assigns one of three tasks, deploys a single-asset ERC-4626 vault and a separate fungible Agent Key, then opens the first Key ask.

Public interface: [https://liquidmuppets.io](https://liquidmuppets.io)

X: [@AMBF](https://x.com/AMBF)

## Live mainnet scope

- Robinhood Chain ID `4663`
- seven cosmetic pet appearances, independent from task permissions
- three selectable task configurations
- native Agent Key asks, bids, partial fills, buys, sells and permanent binding
- 3% marketplace fee on filled value only
- public activity built from contract logs
- optional app handles claimed with a wallet signature and no gas
- no deployer or keeper key in the browser, API, or VPS

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
- `MorphoBlueAdapter`: [`0x169EfD23f67811709C0Db823f7c82fcF2732781d`](https://robinhoodchain.blockscout.com/address/0x169EfD23f67811709C0Db823f7c82fcF2732781d)
- `EZManagerRangeAdapter`: [`0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d`](https://robinhoodchain.blockscout.com/address/0xc6b531e504Ebb718dCd66Df45c9aC63564a0C96d)
- `LaunchReserveAdapter`: [`0x956127B0B586B9427182FCd9325efe032E9B5181`](https://robinhoodchain.blockscout.com/address/0x956127B0B586B9427182FCd9325efe032E9B5181)

The deployer, current owner, and treasury are the dedicated address `0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f`. Deployment receipts and runtime bytecode were checked through RPC. Source verification for this deployment is still pending. The retired zero-agent deployment is preserved in `contracts/deployments/robinhood-mainnet-v1.json`.

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
  -> creator signs a bounded strategy cycle
  -> PolicyExecutor checks authorization, pause, expiry, cooldown and caps
  -> the task's immutable adapter executes
  -> vault accounting reads idle assets plus adapter position value

creator receives a fixed Agent Key supply
  -> creator opens the first ask
  -> lowest active ask becomes the floor
  -> users buy, list, bid, sell, or permanently bind whole Keys
  -> 3% fee applies only when value changes hands
```

Vault shares own the capital claim. Agent Keys are a separate market and access asset. A Key cannot redeem vault assets, and its market price does not change vault share value.

## Strategy controls

Stable yield has a 90% allocation limit, 30 minute cooldown, minimum Morpho supply check, maximum 95% utilization check, and nonzero oracle check. Withdrawals depend on available Morpho liquidity.

ETH range has an 85% allocation limit and 6 hour cooldown. The adapter uses an onchain EZManager valuation, a fixed range width of 1,200 ticks on each side, and up to 3% swap and LP execution slippage. EZManager currently charges 0.4% on entry. The creator can recall the position or atomically close and reopen it around the current tick. A failed reopen reverts the preceding close.

Launch reserve has a 10% allocation limit and 30 minute cooldown. Accounting is isolated by vault and the adapter can only hold and return WETH. It has no administrator withdrawal path.

Full vault redemption recalls the complete adapter position and pays the assets actually realized. This prevents residual adapter dust from being treated as redeemable value, but it does not prevent market loss or venue illiquidity.

## Public activity

`GET /api/v1/activity` scans the deployed contracts from the current deployment block and returns real launches, asks, bids, fills, deposits, withdrawals, allocations, recalls, recenters, and Key bindings. The marketplace polls this endpoint and links every item to its transaction.

- green: buys, deposits, launches and strategy allocations
- red: sells, withdrawals and recalls
- neutral: asks and bids before a fill

`POST /api/v1/profiles/challenge` and `POST /api/v1/profiles/claim` let a wallet claim an app handle with an EIP-191 signature. The signature proves control of that wallet. It does not verify an X account or any other external identity.

## Seeded mainnet state

Three developer fixtures exercise each task without demo data:

- `morpho frog`, stable yield, with a funded and allocated USDG vault
- `range fox`, ETH range, with a real EZManager position
- `launch sage`, launch reserve, with an isolated WETH allocation

Each has a live 20-Key ask at `0.001 ETH` per Key and one permanently bound Key. These are clearly developer-created fixtures. No self-buy or circular resale was broadcast to manufacture trading activity. A real buy and resale needs a second wallet acting as the buyer.

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
```

The fork suites enter and redeem the current Morpho route, and open, atomically recenter, and redeem a current EZManager range.

## Deployment

The deployer key must be dedicated and injected only at runtime. It must never be committed or copied into a frontend variable.

```bash
cd contracts
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com -vvv
forge script script/DeployMainnet.s.sol:DeployMainnet --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast -vvv
```

The frontend uses atomic release directories under `/var/www/liquidmuppets/releases/` with `/var/www/liquidmuppets/current` as the active symlink. The API runs as the unprivileged `liquidmuppets` user from `/opt/liquidmuppets-api/current`, reads `/etc/liquidmuppets/api.env`, and writes SQLite under `/var/lib/liquidmuppets`.

## API

- `GET /api/v1/health`
- `GET /api/v1/contracts`
- `GET /api/v1/strategies`
- `POST /api/v1/strategies/preview`
- `GET /api/v1/activity`
- `POST /api/v1/profiles/challenge`
- `POST /api/v1/profiles/claim`
- `GET /api/v1/profiles/{wallet}`
- `POST /api/v1/keeper/run`
- `GET /api/v1/keeper/runs`

Keeper endpoints remain available for future automation, but mainnet ships with public triggering and automatic signing disabled.

## Risk boundary

- contracts are tested but not independently audited
- stable APY is variable and can be zero
- Morpho withdrawals depend on market liquidity
- concentrated liquidity can underperform holding WETH and incurs swap, LP, and impermanent-loss risk
- launch reserve produces no yield and has no approved token-pool route yet
- USDG, WETH, USDe, their oracles, Morpho, Uniswap, EZManager, and Robinhood Chain add external risk
- the owner controls task configuration, pause, and marketplace fee settings within contract limits
- the current owner is a dedicated EOA, not a multisig
- per-vault caps reduce exposure but do not make deposits risk-free
