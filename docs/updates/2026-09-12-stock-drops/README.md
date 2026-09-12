# liquidmuppets update · stock drops

12 September 2026. This release adds a working holder feature: a funded stock-token allocation that a $MUPPETS holder can claim into their wallet.

Each full 15,000 MUPPETS held at the published snapshot gives one allocation unit. The deposited stock-token pot is divided across eligible units. No Agent Key, MUPPETS deposit or lock is required. Each claim pays the wallet committed in the allocation.

**Status:** code and tests published. The new frontend/API release and contract are not deployed to production. First mainnet snapshot and funding are pending. No holder payout is announced by this update.

## What is new

- A fully funded distributor with immutable allocations, exact recipient payments, no claim expiry and no admin withdrawal route.
- Complete historical holder snapshots, explicit exclusions, exact integer allocations and public Merkle proofs.
- Read-only tooling that verifies the publisher's stock-token balance and prepares unsigned Safe funding calls.
- A Stock Drops page beside Agent Bonds in Earn, with wallet allocations, claim controls, funding totals, snapshot links and the full allocation file.
- Wallet account/network checks, claim simulation and receipt recovery that blocks duplicate submissions after a timeout.
- Initial support for canonical AAPL, AMD, AMZN and ASML Stock Tokens. Supported assets are not funded rewards until a drop is deposited.

## Concrete example

In the local integration test, one wallet held 15,000 MUPPETS and another held 30,000. An explicitly excluded pool stayed in the full supply reconciliation. A synthetic 3 AAPL Stock Token pot gave the two wallets one and two tokens respectively. The first wallet claimed through the actual React interface and API, and its ERC20 balance increased by exactly one token.

That test used disposable local assets. It was not a mainnet purchase, funding event or payout.

## Funding and launch

The first stock-token budget is uncommitted. A publisher must deposit the entire pot from separately approved inventory before a drop exists. This release has no automatic fee feed. The existing reserve, vault deposits and fee splits are separate.

The remaining launch work is independent contract review, verified Safe deployment, a reviewed snapshot and exclusions, a committed stock-token budget, and the production frontend/API release. It can be activated independently of FactoryV2. The [technical runbook](../../STOCK_DROPS.md) contains the exact scripts and checks.

The publisher selects the block and exclusions. The contract verifies the committed allocation; the historical balance verification is performed by the read-only CLI and remains publicly auditable through the manifest. Funded claims do not expire, although issuer transfer restrictions can prevent execution.

## References

OWN's docs put the fee-funded yield in [sEUSD staking](https://docs.own.money/eusd/staking), and state that [MONEY alone carries no yield](https://docs.own.money/money-token). [Quotrons](https://www.quotrons.cash/) ties stock rewards to hardwired terminals. Stock Drops applies the useful part here: an explicit funded asset allocation for an eligible holder. The comparison and trust boundaries are in the [mechanics document](../../STOCK_DROPS.md).

## Copy

- [Founder tweets](FOUNDER-TWEETS.txt): five standalone posts and one seven-post thread.
- [Official tweets](OFFICIAL-TWEETS.txt): five standalone posts and one seven-post thread.
- [Founder article](FOUNDER-ARTICLE.txt): the direct holder benefit and first-pot boundary.
- [Official article](OFFICIAL-ARTICLE.txt): mechanics, evidence and launch status.
- [Bios](BIO-SUGGESTIONS.txt): three options for each account.

Use the first standalone for each account. Every post announces the implementation or explains its rules; none says mainnet claims are active. The release includes copy only for X, with no social post sent.

## Validation

The contract tests cover exact funding and transfers, invalid proofs, recipient changes, cross-chain/drop/contract replay, double claims, budgets, failed transfers, reentrancy and budget conservation across 256 fuzz runs. Python and TypeScript verify the same canonical allocation fixture.

The local browser test passed through real API reads and an actual simulated-chain wallet claim, plus duplicate protection, missing-manifest failure, wrong-network rejection and desktop/mobile layouts. A separate mainnet-fork test passed funding and claims against all four canonical stock-token contracts using synthetic fork inventory. The first pinned historical fork attempt failed because the public RPC lacked metadata; the retry on a fresh head passed. This does not establish future issuer transfer availability or constitute an independent audit.

Commands and source: [Stock Drops runbook](../../STOCK_DROPS.md), [contract](../../../contracts/src/MuppetStockDrops.sol), [publisher tooling](../../../backend/app/stock_drops_cli.py), [claim page](../../../src/pages/StockDropsPage.tsx), [local integration test](../../../qa/stock-drops.mjs).
