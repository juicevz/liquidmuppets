# liquidmuppets update · 11 september 2026

The latest work makes Muppets easier to launch and inspect, then adds a clearer wallet view for the reward system being prepared. This pack covers the recent product releases through `f008f82`, checked against the public app and API on 11 September 2026.

## Copy

- [Founder tweets](FOUNDER-TWEETS.txt): recommended update, standalone posts and a seven-post thread.
- [Official tweets](OFFICIAL-TWEETS.txt): recommended update, standalone posts and a seven-post thread.
- [Founder article](FOUNDER-ARTICLE.txt): a personal build update.
- [Official article](OFFICIAL-ARTICLE.txt): the product update and current activation state.
- [Bio suggestions](BIO-SUGGESTIONS.txt): three options for each account.

The first draft in each tweet file is the recommended post. Labels sit outside the copy. Thread numbering belongs in the post.

## What changed

| Work | What it changes for users | State checked on 11 September |
| --- | --- | --- |
| Simpler creation | Three stages: pet and name, one vault job, then launch and funding. An Agent Key listing is optional after launch. | Live |
| Creator Slots | Every 15,000 liquid MUPPETS unlocks one slot. The app shows used and available capacity and the next launch threshold. | Live in the app and API; the current V1 factory does not enforce the rule itself |
| Public evidence | Performance and creator pages, System Pulse and automatic Proof Cards expose recorded activity. Watchlists, alerts and Market Radar make it easier to follow Muppets and inspect route conditions. | Public; watchlists and alerts are stored in the browser |
| Earn page | One wallet view for bonds, claimable WETH, lifetime claimed rewards, wallet receipts, reinvested amounts and unlock dates. | Page live at `/app/earn`; staking and payouts await activation |
| Revenue by Muppet Key | The V2 marketplace records the exact Key behind a fee and keeps its reward accounting separate. Legacy Key fees remain global. | Views and implementation published; V2 fee routing inactive |
| Weekly reward accounting | Fees stay assigned to the week they reach the router. A delayed distribution uses that week's eligible positions. | Implemented; router deployment pending |
| Fixed Agent Bonds | One unit requires 15,000 MUPPETS and one unused, permanently bound Key. Terms are 30, 90 or 180 days, with seven-day maturation and full-week eligibility. | Implemented; Agent Bond deployment pending |
| Optional reinvestment | Claim one position's rewards, spend a chosen portion on MUPPETS and open a new bond in one transaction after reviewing a quote. | Published; transactions disabled pending activation |

The existing mainnet beta still includes USDG stable yield, a WETH range strategy and a WETH launch reserve. The launch reserve stages WETH and currently produces no yield. Vault shares represent deposited assets; Agent Keys remain separate and cannot redeem those assets.

## Current activation state

The live revenue API returned `status: activation_pending`, undeployed router, bond and buyback contracts, and `reinvestment.available: false`. Pons reported `buyback_enabled: false`. The token access API reported a configured 15,000-MUPPETS slot with `enforcement: app_and_api`.

The reward design uses recorded revenue and creates no token emissions. A longer bond changes its share of the reward pot. It does not increase that pot or promise a return. If a receipt week has no eligible positions, its reward share remains permanently unallocated to that week under the current implementation, with no recovery route.

FactoryV2 still needs its runtime reduced below the EIP-170 deployment limit. Deployment, source verification, Safe ownership and configuration remain outstanding. Independent contract review and the empty-week policy also remain part of the activation work. This update announces the published work, with staking, payouts, reinvestment and buybacks still pending.

## Sources

| Claim | Primary source |
| --- | --- |
| Mainnet health and slot configuration | [Live health](https://liquidmuppets.io/api/v1/health), [live contracts](https://liquidmuppets.io/api/v1/contracts) |
| Revenue activation, bond terms and fee splits | [Live revenue state](https://liquidmuppets.io/api/v1/revenue), [product specification](../../MVP.md) |
| Earn wallet totals and unavailable-data behavior | [Earn UI](../../../src/components/EarnWallet.tsx), [wallet accounting service](../../../backend/app/services/earn.py), [Earn tests](../../../backend/tests/test_earn.py) |
| Receipt weeks and exact-Key attribution | [Revenue Router](../../../contracts/src/MuppetRevenueRouter.sol), [revenue tests](../../../contracts/test/MuppetRevenue.t.sol) |
| Bond eligibility and reward-funded reinvestment | [Agent Bond](../../../contracts/src/MuppetAgentBond.sol), [reinvestment tests](../../../contracts/test/MuppetRewardReinvestment.t.sol) |
| Public proof records and route evidence | [Proof API](https://liquidmuppets.io/api/v1/proofs?limit=3), [Market Radar API](https://liquidmuppets.io/api/v1/market-radar) |
| Release sequence | [Earn and receipt weeks](https://github.com/juicevz/liquidmuppets/commit/f008f82), [reinvestment](https://github.com/juicevz/liquidmuppets/commit/1822ece), [bond epochs](https://github.com/juicevz/liquidmuppets/commit/596d266), [Key revenue](https://github.com/juicevz/liquidmuppets/commit/565ef77) |

Live checks returned HTTP 200 for health, contracts, revenue, proofs, Market Radar, Earn and docs. A browser check confirmed the Earn activation notice and the three-stage creator with its app/API slot label. No wallet connection or transaction was needed.

Validation for this pack: 49 existing revenue and reinvestment contract tests, 54 backend Earn and revenue tests, and 40 frontend Earn and reinvestment tests passed. All 24 tweets are at most 280 characters, all six bios are at most 160, and the local documentation links resolve. These focused checks are not an independent audit.

## Product links

- [App](https://liquidmuppets.io)
- [Earn](https://liquidmuppets.io/app/earn)
- [Create a Muppet](https://liquidmuppets.io/app/create)
- [Proof Cards](https://liquidmuppets.io/app/proofs)
- [Watchlists and Market Radar](https://liquidmuppets.io/app/watchlist)
- [Product docs](https://liquidmuppets.io/docs)
