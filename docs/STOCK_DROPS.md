# Muppet Stock Drops

Stock Drops gives eligible $MUPPETS holders a direct claim on a separately funded stock-token pot. Each full 15,000 MUPPETS in a wallet at a published historical block gives one allocation unit. A drop's entire stock-token budget is divided proportionally across eligible units and paid directly to the allocated wallets.

**Release state, 12 September 2026:** implemented and tested in this repository. The new frontend/API release and the Stock Drops contract have not been deployed to production. No mainnet holder snapshot or first funded pot has been published. This update does not activate Agent Bonds or move any live asset.

## The money required

A publisher must supply the full stock-token budget before creating a claim. For a 3 AAPL Stock Token drop, the publisher needs 3 transferable AAPL Stock Tokens in its Safe, plus ETH for approval and funding gas. Holders pay ETH for their own claim gas, unless someone separately relays the claim for them. Neither MUPPETS market value nor a displayed reserve balance funds this obligation.

The first budget is **uncommitted**. No protocol revenue is automatically routed to Stock Drops. A founder or sponsor can deliberately fund a pot from separate inventory; a future approved fee-funded policy would need its own implementation and authorization. Existing `FeeRwaReserve` balances, vault deposits, Key fees, pending bond rewards and the empty-week balances in the Revenue Router remain separate.

Rewards are limited to the inventory actually deposited. There is no fixed APY, payout schedule, new token emission, leverage, stablecoin liability or claim on another vault. A small pot shared across many units produces a small allocation. Before funding, inspect the full manifest's holder count, total units and smallest allocation against expected claim gas.

## Why this mechanic

| Reference | Source-backed mechanic | Application here |
| --- | --- | --- |
| OWN / MONEY | OWN documents a fee-funded eUSD staking vault. MONEY ownership itself does not confer yield. | Require an actual funded reward budget and explain which position receives it. |
| Quotrons | The public app describes hardwiring a whole QUOTRON into a terminal eligible for stock-token rewards. | Make the holder benefit an explicit stock-token claim with a visible recipient. |
| LiquidMuppets | Existing slots provide creator capacity; the current stock reserve has no holder redemption route. Agent Bonds remain a separate pending release. | Add a small independent holder distributor with no Key requirement or principal custody. |

Sources checked 12 September: [OWN MONEY token](https://docs.own.money/money-token), [sEUSD staking](https://docs.own.money/eusd/staking), [Quotrons app](https://www.quotrons.cash/), [public Quotrons deployment manifest](https://www.quotrons.cash/migration/v2-deployment.json). The implementation choice is ours. It does not reproduce OWN's collateral/stablecoin system or Quotrons' NFT and burn mechanism.

## Holder rules

1. The publisher selects a past Robinhood Chain block and publishes its hash, full MUPPETS balances and wallet exclusions with reasons. The publisher tool waits at least 12 blocks; this is a confirmation margin, not a guarantee against chain reorganization.
2. Before exclusions, positive holder balances must sum exactly to `totalSupply()` at that block. The CLI verifies every listed balance through archive RPC. Missing event history or an incomplete supplied candidate list makes snapshot creation fail.
3. Each non-excluded wallet receives `floor(balanceRaw / (15_000 * 10^18))` units. Partial units round down. A single-block snapshot does not prove continuous holding. Wallet balances only are counted: pools, exchanges, wrappers and future bonded positions have no automatic look-through attribution.
4. Allocations use integer arithmetic. The budget is divided by unit weight, then leftover raw token units go to the largest fractional remainders. Ties use ascending wallet address. The allocations sum to the exact funded budget. A budget too small to give every eligible wallet a positive allocation is rejected.
5. The publisher deposits the full budget and commits the root and file hash in one `fundDrop` transaction. Each drop contains one stock-token asset. The initial deployment allowlist is AAPL, AMD, AMZN and ASML, using the same canonical token addresses as the existing reserve.
6. An allocated wallet claims its exact amount. Holding a Key, depositing MUPPETS, approving a token or maintaining the snapshot balance after publication is unnecessary. Buying after the snapshot does not create an allocation in that drop.

Illustration only: if the eligible snapshot contains 15,000 MUPPETS in wallet A and 30,000 in wallet B, the total is three units. A fully funded 3 AAPL Stock Token pot gives A one token and B two. This is also the synthetic local browser test; it is not a live funded drop or a suggested first budget.

## Contract and trust

[`MuppetStockDrops.sol`](../contracts/src/MuppetStockDrops.sol) uses OpenZeppelin safe transfers, two-step ownership, reentrancy protection and sorted-pair Merkle verification. Each leaf is:

```text
keccak256(keccak256(abi.encode(chainId, contract, dropId, index, account, amount)))
```

The chain, contract and drop separate claims from other deployments or allocations. The recipient is inside the leaf; even a third-party relayer can only pay that recipient. Claims are marked before transfer, and a failed or inexact transfer reverts the whole operation. Budgets and liabilities remain isolated between drops.

There is no root update, claim expiry, pause, admin withdrawal, arbitrary call, upgrade path or recovery function. Ownership changes affect publication of future drops only. Unclaimed allocations remain committed to the original wallets indefinitely. Mistaken direct token transfers, excess unsolicited inventory and malformed published roots cannot be recovered through this contract; review the canonical manifest before funding.

The publisher chooses the block and exclusions. The contract verifies the allocation commitment and deposited inventory; it cannot independently read past MUPPETS balances. The public file makes the policy and arithmetic auditable, and the CLI checks balances against archive RPC. These checks do not remove publisher trust or prove that every exclusion was fair.

Only reviewed, non-rebasing, exact-transfer ERC20s belong in the immutable allowlist. Stock-token issuers can restrict transfers or change supported behavior. An issuer restriction can delay a claim even when its pot is funded. A transfer failure does not consume the allocation. This contract has not received an independent audit.

If an issuer reduces the distributor's stock-token balance below its committed liability, both claims and new drops in that token stop. A separate top-up would need to restore the existing liability first. This prevents a new pot from silently covering an older inventory shortfall.

## Publisher workflow

Use a dedicated Safe with at least two owners and a threshold of at least two. Complete independent review and source verification before mainnet funding. Stock Drops deploys independently of FactoryV2 and does not change any existing contract owner or fee destination.

From `contracts/`, simulate deployment with a public Safe address already set in `STOCK_DROPS_SAFE`:

```bash
forge script script/DeployStockDrops.s.sol:DeployStockDrops --rpc-url robinhood_mainnet
```

That command is a simulation. A real deployment, acquisition of stock tokens, funding transfer and production release are separate actions. Use the existing secret-management workflow for any explicitly authorized signing operation. The script accepts Foundry's signer configuration and contains no private key lookup.

From `backend/`, inspect the read-only publisher CLI:

```bash
.venv/bin/python -m app.stock_drops_cli --help
```

Collect a complete candidate holder list from an indexer as a JSON array of addresses, or use the CLI's Transfer-event scan starting at the exact token deployment block. Exclusions are a JSON array of `{ "account": "0x...", "reason": "..." }` with lowercase addresses. Include custody, burn and protocol addresses deliberately in the policy review; the tool does not infer beneficial ownership.

```bash
.venv/bin/python -m app.stock_drops_cli snapshot --block "$SNAPSHOT_BLOCK" --holders "$HOLDER_CANDIDATES" --exclusions "$EXCLUSIONS_FILE" --out "$SNAPSHOT_FILE"
.venv/bin/python -m app.stock_drops_cli build --snapshot "$SNAPSHOT_FILE" --contract "$STOCK_DROPS_ADDRESS" --id "$DROP_ID" --token "$REWARD_TOKEN_LOWERCASE" --budget-raw "$BUDGET_RAW" --out "$MANIFEST_FILE"
.venv/bin/python -m app.stock_drops_cli prepare --manifest "$MANIFEST_FILE" --out "$SAFE_BATCH_FILE"
```

These variables are public task inputs, not secrets. The budget uses 18-decimal raw stock-token units. `snapshot` also accepts `--from-block` instead of `--holders`, verifies no token code existed before that start, and scans Transfer logs in bounded chunks. The final supply reconciliation is mandatory in both modes. Archive RPC must support the chosen block; missing historical metadata is an error, never permission to substitute current balances.

`build` rechecks every historical balance. `prepare` checks the same snapshot, deployed contract, next drop ID, allowed reward asset, Safe threshold and its token balance. It produces unsigned exact-amount approval and funding calls for Safe Transaction Builder. It never signs, broadcasts, swaps or spends. All output files are created exclusively; it will not overwrite a reviewed file.

Review the recipients and exclusions, hash the exact canonical file, simulate the Safe batch, and independently compare its root, budget, token, snapshot and destination. Fund only after this review. The onchain `expectedId` prevents a stale batch from silently funding a different drop ID. Do not rely on the self-reported contract version as a replacement for source and bytecode verification.

Publish the canonical file as `{dropId}.json` inside `STOCK_DROPS_MANIFEST_DIR`, preserving its exact bytes. Keep durable copies in the public repository or another public archive as well. The API's manifest URL alone is not permanent storage. Each manifest includes the full snapshot and proofs, so claims can be submitted outside this frontend if the site is unavailable.

## API, interface and operations

| Setting or route | Behavior |
| --- | --- |
| `STOCK_DROPS_ADDRESS` | Empty by default; configure only after reviewed deployment. |
| `STOCK_DROPS_MANIFEST_DIR` | Local canonical files, default `/var/lib/liquidmuppets/stock-drops`; no remote fetch or signing. |
| `GET /api/v1/stock-drops?wallet=0x...&before=10` | At most ten drops before the exclusive cursor; returns `next_before` for older entries. Wallet is optional. |
| `GET /api/v1/stock-drops/{id}/manifest` | Full canonical snapshot, exclusions, allocation math and proofs. File availability alone does not establish funding. |
| `/app/stock-drops` | Stock-token claims; Agent Bonds remains a separate Earn tab. |

The API rebuilds the manifest, checks its commitment against the contract, verifies the snapshot block hash and reads funding, token liabilities and claim status at one block. It confirms that read block was not reorganized during the request. It does not re-read every historical wallet balance on every page request. Supported bounds are 10,000 holder candidates and an 8 MB canonical manifest. Large holder sets may need a reviewed scaling change before publication.

Unconfigured state is distinct from a configured contract with zero drops and from an RPC failure. Unknown counts remain null. Missing, invalid or underfunded evidence disables the affected claim. The UI rechecks contract identity, root, recipient, snapshot, funding commitment and claimed status, simulates the claim, estimates gas through the wallet and rechecks the active account and network before sending. Submitted hashes are saved before receipt polling; a timeout cannot trigger an automatic duplicate.

## Verification

```bash
npm run check
npm run qa:stock-drops
```

From `backend/`:

```bash
.venv/bin/ruff check app tests
.venv/bin/mypy app
.venv/bin/pytest
```

From `contracts/`:

```bash
forge test --match-contract MuppetStockDropsTest
RUN_STOCK_DROPS_FORK=true forge test --match-contract MuppetStockDropsForkTest -vv
```

The local browser test creates an isolated Anvil chain, synthetic stock tokens and holder balances; it runs the actual Python snapshot builder, Solidity funding/claim contract, FastAPI and React wallet flow. It covers desktop, 390px and 320px, missing files, wrong networks, exact receipts and duplicate protection. Screenshots stay in the printed temporary directory and are never marketing proof of funded mainnet rewards. The optional fork test depends on historical-state support from the public provider and uses synthetic fork-only inventory.
