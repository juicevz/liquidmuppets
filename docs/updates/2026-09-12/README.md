# liquidmuppets update · 12 september 2026

This edition explains what a creator can use today: MUPPETS capacity, a vault with one job, separate funding, optional Key listings and the controls available after launch.

The product implementation remains at `f008f82`. No new product commit or activation has occurred since [yesterday's update](../2026-09-11-02/README.md). This pack adds fresh copy, a practical product walkthrough and live checks from 12 September at approximately 10:55 UTC.

## Copy

- [Founder tweets](FOUNDER-TWEETS.txt): five standalone posts and a seven-post thread.
- [Official tweets](OFFICIAL-TWEETS.txt): five standalone posts and a seven-post thread.
- [Founder article](FOUNDER-ARTICLE.txt): what MUPPETS unlocks today.
- [Official article](OFFICIAL-ARTICLE.txt): from Creator Slot to funded vault.
- [Bio suggestions](BIO-SUGGESTIONS.txt): three options for each account.

The first standalone is the recommended post for each account. Copy the text below its label. Thread numbers belong in the posts.

## The current creator flow

1. Browse the marketplace, Muppet pages, Proof Cards and route evidence without connecting a wallet.
2. Connect on Robinhood Chain. The app checks the MUPPETS balance and the number of Muppets already created by that wallet.
3. Each 15,000 MUPPETS held unlocks one Creator Slot. Available capacity is unlocked slots minus used slots, with a floor of zero. The current rule is enforced in the app and API; the V1 factory itself remains directly callable.
4. Choose a cosmetic pet and name, then choose one vault job. Review its asset, allocation limit, idle reserve and planned funding.
5. Confirm creation. The factory creates the Muppet's vault and Agent Key. Funding uses separate asset approval and deposit transactions.
6. Review the share preview and fund the vault with its task asset. Vault shares represent that deposit.
7. Open an Agent Key listing if desired, using a chosen Key approval and a separate listing transaction. Creating or funding a vault does not require a Key listing.
8. Follow the public position, keeper decisions and receipts. The creator or private keeper can request a strategy cycle within the policy limits. Depositors redeem through their vault shares, subject to the route's liquidity and realized assets.

For example, 30,000 MUPPETS unlocks two slots. A wallet with one existing Muppet has one available launch slot. The tokens remain transferable. A balance drop affects further launches and featured placement above current capacity; existing vault access and Key markets remain available.

## Three jobs in the live creator

| Job | Deposit | Configured allocation limit | Current behavior |
| --- | --- | --- | --- |
| Stable yield | USDG | Up to 90%; at least 10% idle | Supplies to one fixed Morpho Blue market; 10,000 USDG vault cap |
| ETH range | WETH | Up to 85%; at least 15% idle | Opens a WETH/USDG range through EZManager; 1 WETH vault cap |
| Launch reserve | WETH | Up to 10%; at least 90% idle | Stages recallable WETH in an isolated reserve; 0.25 WETH vault cap; no yield or launch-token pool execution |

These are policy limits, rather than a guarantee that a particular fraction of assets is deployed at all times. AAPL/USDG, NVDA/USDG, SPY/USDG and screened meme/WETH remain review candidates. They are not live launch choices.

## Three different roles

| Asset | Role today |
| --- | --- |
| MUPPETS | Unlocks creator capacity in the app and API. It is not the asset deposited into these vault routes. |
| Vault shares | Represent deposited assets in one vault and its redemption accounting. |
| Agent Keys | Have a separate market and permanent-binding mechanism. They cannot redeem vault assets. |

## Live state checked today

| Read | Result |
| --- | --- |
| Health | Production healthy, RPC connected, chain ID 4663, contracts and keeper configured |
| Access gate | Configured; `slotSize: 15000`; `enforcement: app_and_api` |
| Strategies | Three live jobs, including the reserve-only route; four review candidates |
| Market Radar | Three routes reported `live`; four candidates reported `review` |
| Revenue | `activation_pending`; Router, Agent Bond and buyback contracts undeployed |
| Reinvestment / Pons buyback | Unavailable / disabled |
| Stock Token reserve | Four cumulative purchases; AAPL, AMD, AMZN and ASML held; 0.0036 ETH fees received; 0.0136 ETH total spent including the 0.01 ETH developer bootstrap |

The reserve response was non-stale at block `61050769`. Its totals are unchanged from yesterday's snapshot and its latest purchase remains 7 September. They are not new purchases or holder payouts.

Earn is public, and the weekly accounting and optional reward-reinvestment implementation are published. Staking, reward payouts, reinvestment and buybacks remain inactive. FactoryV2 still requires size reduction, independent review, verified deployment, Safe ownership and configuration before activation. The existing empty-week reward policy also needs review: shares for weeks without eligible positions remain permanently unallocated, with no recovery mechanism in the current implementation.

## Sources and checks

The [live creator](https://liquidmuppets.io/app/create) loaded successfully. A browser check advanced from pet and name to the job picker, confirmed the three routes and their allocation labels, and found no page errors. It used no wallet connection or transaction.

- [Contracts API](https://liquidmuppets.io/api/v1/contracts), [strategies API](https://liquidmuppets.io/api/v1/strategies), [Market Radar API](https://liquidmuppets.io/api/v1/market-radar), [revenue API](https://liquidmuppets.io/api/v1/revenue), [reserve API](https://liquidmuppets.io/api/v1/rwa-reserve) and [health API](https://liquidmuppets.io/api/v1/health): fresh HTTP 200 responses.
- [Creator capacity](../../../backend/app/services/token_gate.py): balance, used slots and next-launch calculation.
- [Creator interface](../../../src/pages/CreateAgentPage.tsx): three stages, separate funding, receipt recovery and optional Key listing.
- [Product specification](../../MVP.md): route behavior, redemption and current activation boundaries.

All 24 tweets fit within 280 characters; all six bios fit within 160. Copy was checked for exact duplication against both earlier packs, and local documentation links were checked. This commit changes documentation and copy only.
