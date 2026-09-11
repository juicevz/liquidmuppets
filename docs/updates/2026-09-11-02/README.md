# liquidmuppets update 02 · following a Muppet

11 September 2026, evening edition. This follow-up focuses on the public record after launch: vault performance, keeper decisions, Key-market fees and the Stock Token reserve.

The repository has no new product commits since [the earlier update](../2026-09-11/README.md). The implementation baseline remains `f008f82`; this is fresh copy and a refreshed live snapshot. Purchase totals below are cumulative, with the latest reserve purchase recorded on 7 September. They are not purchases made since the previous content pack.

## Copy

- [Founder tweets](FOUNDER-TWEETS.txt): five standalone posts and a seven-post thread.
- [Official tweets](OFFICIAL-TWEETS.txt): five standalone posts and a seven-post thread.
- [Founder article](FOUNDER-ARTICLE.txt): following the money in a Muppet.
- [Official article](OFFICIAL-ARTICLE.txt): vaults, fees and public records.
- [Bio suggestions](BIO-SUGGESTIONS.txt): three options per account.

The first standalone is the recommended post for each account. Labels are outside the copy; thread numbering belongs in the post.

## Verified reserve snapshot

The [reserve API](https://liquidmuppets.io/api/v1/rwa-reserve) returned the following state during the 19:25 UTC check, at block `60501689`, with `stale: false`.

| Metric | Recorded value |
| --- | --- |
| Completed purchases | 4 |
| Stock Tokens with a positive reserve balance | AAPL, AMD, AMZN, ASML |
| Enabled purchase routes | 26 |
| Marketplace fees received | 0.0036 ETH |
| Total native asset spent | 0.0136 ETH |
| Total USDG spent on Stock Token purchases | 33.522348 USDG |
| Initial developer-funded cycle | 0.01 ETH, documented separately from marketplace fees |
| Last purchase | 7 September 2026, 04:02:19 UTC |
| Available native balance for another cycle | 0 ETH |

These are purchase and funding counters, not current portfolio value or holder earnings. The reserve's fee counter accepts only transfers from its configured marketplace fee source. Direct funding uses a separate event. The four holdings are Stock Tokens; MUPPETS holders and Agent Key holders do not receive a redemption claim on that reserve.

## What readers can use now

| Surface | What it shows |
| --- | --- |
| [A live Muppet page](https://liquidmuppets.io/app/muppet/1) | Share price, vault assets, tracked asset change, deposits and withdrawals, deployed versus idle capital, route details, keeper decision and a separate Key market |
| [Proof Cards](https://liquidmuppets.io/app/proofs) | Shareable records for meaningful events; a hold is identified as having no transaction |
| [System Pulse](https://liquidmuppets.io/app/pulse) | Decoded chain events and recorded keeper actions or holds |
| [Watchlists and Market Radar](https://liquidmuppets.io/app/watchlist) | Browser-local following and alerts, plus available route evidence and review status |
| [Create a Muppet](https://liquidmuppets.io/app/create) | Three-stage creation and 15,000-MUPPETS Creator Slots, enforced in the app and API |
| [Earn](https://liquidmuppets.io/app/earn) | The wallet rewards interface and its current activation notice |

Performance uses the first recorded checkpoint as its baseline and adjusts asset change for recorded deposits and withdrawals. It is not an annualized return. Route health describes the route checks, rather than the profitability of the vault.

The [reserve's daily keeper record](https://liquidmuppets.io/proof/keeper-holds-20260911-reserve) reported that the balance had not reached the purchase threshold. The record explicitly carried no transaction. The configured minimum is 0.0001 ETH, the per-cycle maximum is 0.01 ETH and the cooldown is 30 minutes, with route and oracle checks before execution.

## Earn and remaining work

At `2026-09-11T19:25:11Z`, the [revenue API](https://liquidmuppets.io/api/v1/revenue) returned `activation_pending`, undeployed Router, Agent Bond and buyback contracts, unavailable reinvestment and a disabled Pons buyback. The Earn page displayed the same pending state.

Weekly receipt accounting, exact-Key reward attribution and optional reward-funded reinvestment are implemented. The current legacy marketplace still sends its 3% settled-trade fee directly to the reserve. Future revenue splits belong to the pending migration. The content does not describe those future splits as the current fee route.

FactoryV2 still needs its runtime reduced before deployment. Independent review, source verification, Safe ownership and fee-route configuration remain outstanding. The current contract leaves reward shares permanently unallocated when a week has no eligible positions; that policy also needs review before activation. No reward, reinvestment or buyback activation is announced here.

## Evidence and validation

Source checks used the current repository and fresh public API responses.

- [Fee reserve implementation](../../../contracts/src/FeeRwaReserve.sol): fee source, funding events and cycle limits.
- [Performance calculation](../../../backend/app/services/performance.py): deposits, withdrawals and the tracked baseline.
- [Proof records](../../../backend/app/services/proofs.py): event classification and daily hold summaries.
- [Product specification](../../MVP.md) and [repository README](../../../README.md): launch flow, reserve bootstrap and migration boundaries.
- [Health API](https://liquidmuppets.io/api/v1/health), [contracts API](https://liquidmuppets.io/api/v1/contracts), [performance API](https://liquidmuppets.io/api/v1/marketplace/performance) and [proof API](https://liquidmuppets.io/api/v1/proofs?limit=3): successful live reads.

Browser checks loaded the range fox performance page and Earn with no page errors. Purchase totals and held symbols above come from the successful, non-stale reserve response. All 24 tweets were checked below 280 characters, six bios below 160, and local documentation links were checked. This release changes documentation and copy only.
