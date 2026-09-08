import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Isolated read-model fixtures. This harness never connects a real wallet or signs a transaction.
const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
if (!['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)) {
  throw new Error('Synthetic Earn QA requires a local Vite server.')
}
const wallet = '0x1111111111111111111111111111111111111111'
const bond = '0x2222222222222222222222222222222222222222'
const key = '0x3333333333333333333333333333333333333333'
const muppets = '0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189'
const weth = '0x4444444444444444444444444444444444444444'
const txHash = `0x${'ab'.repeat(32)}`
const reinvestHash = `0x${'cd'.repeat(32)}`
const explorer = 'https://example.invalid'
const errors = []
const results = { fixture: 'synthetic Earn read models; no transactions or real wallet access' }
const screenshotDir = new URL('./screenshots/', import.meta.url)
await mkdir(screenshotDir, { recursive: true })
const viteEntry = await (await fetch(`${baseUrl}/src/main.tsx`)).text()
const reactUrl = viteEntry.match(/from ["']([^"']*\/react\.js\?[^"']*)["']/)?.[1]
const reactDomUrl = viteEntry.match(/from ["']([^"']*\/react-dom_client\.js\?[^"']*)["']/)?.[1]
if (!reactUrl || !reactDomUrl) throw new Error('Could not resolve Vite React dependencies.')

function fixture(kind, cursor = 0) {
  const now = Math.floor(Date.now() / 1000)
  const empty = kind === 'empty'
  const unavailable = kind === 'unavailable'
  const pending = kind === 'pending' || kind === 'disconnected'
  const paused = kind === 'paused'
  const incomplete = kind === 'accounting-unavailable'
  const tiny = kind === 'tiny'
  const position = {
    id: '12', key, units: '2', muppets_raw: '30000000000000000000000',
    bonded_at: now - 1_400_000, matures_at: now - 800_000,
    eligible_from: now - 500_000, eligible_until: now + 700_000, unlock_at: now + 900_000,
    term_days: 30, withdrawn: false,
    claimable_global_weth_raw: tiny ? '1' : '10000000000000000', claimable_key_weth_raw: tiny ? '0' : '20000000000000000',
  }
  if (kind === 'paginated' && cursor === 50) position.id = '62'
  if (kind === 'waiting') { position.eligible_from = now + 500; position.matures_at = now - 100 }
  if (kind === 'warming') { position.matures_at = now + 100; position.eligible_from = now + 500 }
  if (kind === 'ended') position.eligible_until = now - 100
  if (kind === 'unlocked') { position.eligible_until = now - 200; position.unlock_at = now - 100 }
  const earn = {
    status: pending ? 'activation_pending' : unavailable ? 'unavailable' : 'available',
    reason: unavailable ? 'Wallet reward data is temporarily unavailable.' : pending ? 'Activation pending.' : 'Synthetic wallet read model.',
    staked_muppets_raw: pending || unavailable ? null : empty ? '0' : position.muppets_raw,
    claimable_weth_raw: pending || unavailable ? null : empty ? '0' : tiny ? '1' : '30000000000000000',
    claimed_weth_raw: pending || unavailable || incomplete ? null : empty ? '0' : '150000000000000000',
    reinvested_weth_raw: pending || unavailable || incomplete ? null : empty ? '0' : '50000000000000000',
    received_weth_raw: pending || unavailable || incomplete ? null : empty ? '0' : '100000000000000000',
    accounting_status: pending || unavailable || incomplete ? 'unavailable' : 'contract_totals',
    positions: pending || unavailable || empty ? [] : [position],
    positions_status: pending ? 'activation_pending' : unavailable ? 'unavailable' : 'available',
    positions_total: pending || unavailable ? null : empty ? '0' : kind === 'paginated' ? '51' : '1',
    position_cursor: cursor, next_position_cursor: kind === 'paginated' && cursor === 0 ? 50 : null,
    positions_truncated: kind === 'paginated' && cursor === 0,
    receipts: pending || unavailable || empty || incomplete ? [] : [
      { kind: 'reinvested', position_id: '12', key, global_weth_raw: '40000000000000000', key_weth_raw: '30000000000000000',
        claimed_weth_raw: '70000000000000000', reinvested_weth_raw: '50000000000000000', received_weth_raw: '20000000000000000',
        muppets_bought_raw: '20000000000000000000000', new_position_id: '13', tx_hash: reinvestHash, log_index: 9, block_number: 999,
        timestamp: now - 1200, url: `${explorer}/tx/${reinvestHash}` },
      { kind: 'claimed', position_id: '12', key, global_weth_raw: '60000000000000000', key_weth_raw: '20000000000000000',
        claimed_weth_raw: '80000000000000000', reinvested_weth_raw: '0', received_weth_raw: '80000000000000000',
        muppets_bought_raw: null, new_position_id: null, tx_hash: txHash, log_index: 3, block_number: 990,
        timestamp: now - 1800, url: `${explorer}/tx/${txHash}` },
    ],
    receipt_status: pending ? 'activation_pending' : unavailable || incomplete ? 'unavailable' : 'available',
    receipt_range: pending || unavailable ? null : { from_block: 980, to_block: 1000, complete_from_deployment: false },
    receipts_truncated: false,
    block_number: pending || unavailable ? null : 1000,
  }
  return {
    generated_at: new Date().toISOString(), status: pending || paused ? 'activation_pending' : 'live',
    status_detail: paused ? 'New bonds are paused. Existing reward claims and matured withdrawals remain available.'
      : pending ? 'Contracts await verified activation. Rewards are not live.' : 'Synthetic verified read model.',
    reinvestment: { available: !pending && !paused && !unavailable, reason: 'Synthetic fixture', executor: bond,
      minimum_muppets_raw: '15000000000000000000000', maximum_deadline_seconds: 300, capability: 'claim_buy_and_bond', version: 1 },
    network: { chain_id: 4663, chain_name: 'Robinhood Chain', explorer_url: explorer },
    contracts: { muppets, weth, revenue_router: pending ? null : bond, agent_bond: pending ? null : bond,
      buyback_vault: null, buyback_executor: null, universal_router: null, stock_reserve: null,
      pons_fee_policy: null, pons_fee_escrow: null, pons_curve: null, pons_pool_id: null },
    reward_unit: { muppets: '15000', bound_agent_keys: '1', lock_days: 30, maturation_days: 7, epoch_days: 7,
      terms: [{ days: 30, weight: '1x' }, { days: 90, weight: '1.25x' }, { days: 180, weight: '1.5x' }],
      formula: 'One unit per 15,000 MUPPETS and one unused bound Key', creator_slots: 'Bonded tokens count after activation' },
    target_fee_route: [
      { id: 'pons', label: 'Pons protocol', percent: '0.300%' }, { id: 'buyback', label: 'Pons buyback', percent: '0.350%' },
      { id: 'bonds', label: 'Agent Bonds', percent: '1.175%' }, { id: 'reserve', label: 'Stock reserve', percent: '0.705%' },
      { id: 'operations', label: 'Operations', percent: '0.470%' },
    ],
    router_split: { input: 'Creator revenue', agent_bonds: '50%', stock_reserve: '30%', operations: '20%', cadence: 'weekly', zero_revenue_rule: 'No revenue, no distribution' },
    key_market_split: { input: 'V2 Key fees', agent_bond_weth: '50%', muppets_buyback: '25%', stock_token_reserve: '15%', operations: '10%', cadence: 'weekly', vesting: 'five years' },
    pons: { available: true, fee_policy: null, pool_id: null, buyback_enabled: false, current_creator_revenue: '2.700%', block_number: 1000 },
    router: { deployed: !pending, address: pending ? null : bond, paused, total_revenue_routed: '9000000000000000000', total_bond_rewards_delivered: '1000000000000000000',
      // Treasury funding must never become this wallet's earnings.
      total_funding_received: '999000000000000000000' },
    bond: { deployed: !pending, address: pending ? null : bond, paused, total_reward_units: '30', total_bonded_muppets: '450000000000000000000000' },
    buyback: { deployed: false, address: null },
    activation_checks: [{ label: 'Synthetic ownership check', complete: !pending }],
    tracking_started_at: pending ? null : new Date((now - 3600) * 1000).toISOString(), receipt_status: 'available', receipts: [],
    earn_weeks: { status: pending ? 'activation_pending' : unavailable ? 'unavailable' : 'available', reason: 'Synthetic protocol receipt weeks.',
      accounting: 'router_receipt_week', epoch_seconds: 604800, block_number: pending ? null : 1000,
      rows: kind !== 'weeks' ? [] : [
        { epoch: 2956, starts_at: now - 1209600, ends_at: now - 604800, received_wei: '2000000000000000000',
          pons_wei: '2000000000000000000', legacy_key_fees_wei: '0', key_volume_wei: '0', bond_rewards_wei: '1000000000000000000',
          bond_rewards_delivered_wei: '0', unallocated_bond_rewards_wei: '1000000000000000000', buyback_wei: '0',
          stock_reserve_wei: '600000000000000000', operations_wei: '400000000000000000', eligible_weight: '0',
          finalized_at: now - 3600, source: 'global', source_key: null },
        { epoch: 2956, starts_at: now - 1209600, ends_at: now - 604800, received_wei: '1000000000000000000',
          pons_wei: '0', legacy_key_fees_wei: '0', key_volume_wei: '33333333333333333333', bond_rewards_wei: '500000000000000000',
          bond_rewards_delivered_wei: '500000000000000000', unallocated_bond_rewards_wei: '0', buyback_wei: '250000000000000000',
          stock_reserve_wei: '150000000000000000', operations_wei: '100000000000000000', eligible_weight: '10000',
          finalized_at: now - 3600, source: 'exact_key', source_key: key },
      ], has_more: kind === 'weeks', total_weeks: pending ? null : kind === 'weeks' ? '20' : '0', contract_url: null },
    wallet: kind === 'disconnected' ? null : { address: wallet, available: !pending && !unavailable,
      bonded_muppets_raw: earn.staked_muppets_raw, pending_weth_raw: earn.claimable_weth_raw,
      reward_units: empty ? '0' : '2', position_count: empty ? '0' : '1', block_number: 1000, earn },
    boundaries: ['Rewards use recorded protocol fees only. Deposits and treasury funding are not earnings.'],
  }
}

let activeKind = 'disconnected'
const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await context.route('**/__qa_earn', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Earn QA</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
await import('/__qa_earn_entry.mjs');</script></body></html>` }))
await context.route('**/__qa_earn_entry.mjs', (route) => route.fulfill({ contentType: 'text/javascript', body: `
import React from '${reactUrl}'; import ReactDOM from '${reactDomUrl}';
import { RevenuePage } from '/src/pages/RevenuePage.tsx'; import '/src/styles.css';
document.body.dataset.surface = 'app';
const root = ReactDOM.createRoot(document.getElementById('root'));
window.__qa = { renders: 0, walletWrites: [], refreshes: 0 };
window.ethereum = { request: async ({method}) => {
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['${wallet}'];
  if (method === 'eth_chainId') return '0x1237';
  window.__qa.walletWrites.push(method); throw new Error('Synthetic QA cannot sign or send: ' + method);
}};
window.renderEarn = (data, connected = true) => {
  window.__qa.data = data; window.__qa.renders++;
  const earn = data.wallet?.earn;
  const config = { chainId:4663,chainName:'Robinhood Chain',rpcUrl:location.origin+'/api/v1/rpc',explorerUrl:'${explorer}',agentBond:'${bond}',WETH:'${weth}',accessGate:{tokenAddress:'${muppets}',slotSize:'15000'} };
  const agent = { id:0n,name:'test frog',key:{address:'${key}',symbol:'FROG',walletBalance:1n,walletBound:3n},vault:{address:'${bond}'} };
  const positions = (earn?.positions ?? []).map(p => ({ id:BigInt(p.id),units:BigInt(p.units),rewardWeight:BigInt(p.units)*10000n,bondedAt:p.bonded_at,maturesAt:p.matures_at,unlockAt:p.unlock_at,firstEligibleEpoch:p.eligible_from/(7*86400),lastEligibleEpochExclusive:p.eligible_until/(7*86400),multiplierBps:10000,term:0,withdrawn:p.withdrawn,pendingGlobalReward:BigInt(p.claimable_global_weth_raw),pendingKeyReward:BigInt(p.claimable_key_weth_raw) }));
  window.__qa.keyPosition = { committedUnits: positions.length ? 2n : 0n,availableBoundKeys:1n,pendingGlobalReward:positions.reduce((n,p)=>n+p.pendingGlobalReward,0n),pendingKeyReward:positions.reduce((n,p)=>n+p.pendingKeyReward,0n),positions };
  window.__qa.protocol = { config,snapshot:{config,agents: earn?.positions?.length ? [agent] : [],feeBps:300},tasks:[],loading:false,error:'',refresh:()=>window.__qa.refreshes++ };
  root.render(React.createElement('main',{className:'app-main'},React.createElement(RevenuePage,{ key:window.__qa.renders,walletAddress:connected?'${wallet}':undefined,onConnect:async()=>{} })));
};
window.renderEarn(${JSON.stringify(fixture('disconnected'))},false);
` }))
await context.route('**/src/hooks/useProtocol.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export function useProtocol() { return window.__qa.protocol; }' }))
await context.route('**/src/lib/protocol.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
export const getInjectedProvider = () => window.ethereum;
export const readAgentBondKeyPosition = async () => window.__qa.keyPosition;
const blocked = async () => { throw new Error('Synthetic QA forbids wallet writes.'); };
export const bindKeys=blocked,bondAgentKeyUnit=blocked,claimAgentBondPositionRewards=blocked,unbondAgentPosition=blocked;
export function createProtocolClient() { throw new Error('Synthetic Earn QA does not query live chain state.'); }
` }))
await context.route('**/api/v1/revenue*', (route) => route.fulfill({ json: fixture(activeKind, Number(new URL(route.request().url()).searchParams.get('position_cursor') ?? 0)) }))
await context.route('**/api/v1/rpc', (route) => route.abort('blockedbyclient'))

const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
const summary = () => page.getByRole('region', { name: 'Your rewards', exact: true })
const bonds = () => page.getByRole('region', { name: 'Your bonds', exact: true })
const history = () => page.getByRole('region', { name: 'Your reward history', exact: true })
async function render(kind) {
  activeKind = kind
  await page.evaluate(({ data, connected }) => window.renderEarn(data, connected), { data: fixture(kind), connected: kind !== 'disconnected' })
  await page.getByRole('heading', { name: 'Earn.', exact: true }).waitFor()
  await page.waitForTimeout(60)
}

try {
  await page.goto(`${baseUrl}/__qa_earn`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Earn.', exact: true }).waitFor()
  assert.equal(await page.locator('.earn-advanced').getAttribute('open'), null)
  assert.equal(await page.getByRole('button', { name: /Connect/i }).count() > 0, true)
  results.disconnectedConnectAndAdvancedCollapsed = true

  await render('empty')
  const emptyText = await summary().innerText()
  assert.match(emptyText, /0 \$MUPPETS/)
  assert.match(emptyText, /0 WETH/)
  assert.doesNotMatch(emptyText, /Unavailable/i)
  assert.match(await history().innerText(), /no|nothing|yet/i)
  results.connectedVerifiedEmpty = true

  await render('unavailable')
  assert.doesNotMatch(await summary().innerText(), /\b0 WETH|\b0 \$MUPPETS/)
  assert.match(await summary().innerText(), /Unavailable|unavailable|reconnect|Reading|not available|pending/)
  results.unavailableNeverInventsZero = true

  await render('populated')
  const populated = await summary().innerText()
  for (const value of [/30,000 \$MUPPETS/, /0\.03 WETH/, /0\.15 WETH/, /0\.1 WETH/, /0\.05 WETH/]) assert.match(populated, value)
  assert.match(populated, /reinvest|buy|stake/i)
  assert.doesNotMatch(populated, /999|9 ETH|450,000|\bAPY\b|\bAPR\b/)
  assert.equal(await history().locator(`a[href="${explorer}/tx/${txHash}"]`).count(), 1)
  assert.equal(await history().locator(`a[href="${explorer}/tx/${reinvestHash}"]`).count(), 1)
  assert.match(await history().innerText(), /reinvest|bought|buy|stake/i)
  assert.doesNotMatch(await history().innerText(), /999|treasury funding/)
  results.walletOnlyTotalsAndSeparatedCashReinvestment = true
  results.receiptsLinkToExactTransactions = true

  await render('accounting-unavailable')
  const partial = await summary().innerText()
  assert.match(partial, /30,000 \$MUPPETS/)
  assert.match(partial, /0\.03 WETH/)
  assert.match(partial, /Unavailable|unavailable/)
  assert.doesNotMatch(partial, /0\.15 WETH|0\.1 WETH|0\.05 WETH/)
  results.legacyOrMissingCountersStayUnknown = true

  await render('tiny')
  assert.match(await summary().innerText(), /<0\.000001 WETH/)
  results.tinyClaimableIsNotZero = true

  await render('paused')
  const claim = bonds().getByRole('button', { name: 'Claim WETH', exact: true }).first()
  await claim.waitFor()
  assert.equal(await claim.isEnabled(), true)
  assert.doesNotMatch(await page.locator('.revenue-release-state').innerText(), /reward payouts are not active yet/i)
  assert.equal(await bonds().getByRole('button', { name: 'Buy more and stake', exact: true }).isDisabled(), true)
  await page.locator('.earn-advanced > summary').click()
  const bondButton = page.getByRole('button', { name: 'Bond 15,000', exact: true })
  await bondButton.waitFor()
  assert.equal(await bondButton.isDisabled(), true)
  results.pausedClaimsRemainAvailable = true
  results.pausedNewBondsAndReinvestmentBlocked = true

  for (const [kind, expected] of [['warming', /matur|warm|seven|7 day/i], ['waiting', /first|week|waiting/i], ['ended', /complete|ended|finished/i], ['unlocked', /unlocked|withdraw|unstake|unbond/i]]) {
    await render(kind)
    assert.match(await bonds().innerText(), expected)
  }
  results.positionEligibilityAndUnlockStates = true

  await render('paginated')
  await bonds().getByText(/Position #12 /).waitFor()
  await page.getByRole('button', { name: 'Next bonds', exact: true }).click()
  await bonds().getByText(/Position #62 /).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Next bonds', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Previous bonds', exact: true }).click()
  await bonds().getByText(/Position #12 /).waitFor()
  results.bondPagination = true

  await render('weeks')
  await page.locator('.earn-advanced > summary').click()
  const weeks = page.getByRole('region', { name: 'Weekly fee record', exact: true })
  assert.equal(await weeks.locator('.earn-week-list > article').count(), 2)
  const weekText = await weeks.innerText()
  assert.match(weekText, /Global fees/)
  assert.match(weekText, /Unallocated reward share/)
  assert.match(weekText, /original trade week/i)
  assert.match(weekText, /cannot pay later holders/i)
  assert.match(weekText, /limited set of recent receipt weeks/i)
  assert.doesNotMatch(await summary().innerText(), /2 ETH|1 ETH|0\.5 WETH/)
  results.receiptWeeksSourceAndUnallocatedBoundary = true

  await render('populated')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 980 })
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `Earn overflow at ${width}px`)
    await page.screenshot({ path: new URL(`earn-synthetic-${width}.png`, screenshotDir).pathname, fullPage: true })
    await page.locator('.earn-advanced > summary').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `Expanded Earn overflow at ${width}px`)
    await page.locator('.earn-advanced > summary').click()
  }
  results.desktopAndMobileNoOverflow = true
  assert.deepEqual(await page.evaluate(() => window.__qa.walletWrites), [])
  assert.deepEqual(errors, [])
  results.consoleErrors = errors
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '[Page body unavailable]')
  console.error(JSON.stringify({ errors, error: String(error), text: text.slice(0, 2500) }))
  throw error
} finally {
  await context.close()
  await browser.close()
}
