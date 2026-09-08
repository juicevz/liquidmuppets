import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Synthetic UI fixtures only. Contract and transaction-helper tests exercise real execution separately.
const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
if (!['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)) {
  throw new Error('The synthetic reinvestment harness is restricted to a local Vite server.')
}
const devAddress = '0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f'
const submittedHash = `0x${'ab'.repeat(32)}`
const viteEntry = await (await fetch(`${baseUrl}/src/main.tsx`)).text()
const reactUrl = viteEntry.match(/from ["']([^"']*\/react\.js\?[^"']*)["']/)?.[1]
const reactDomUrl = viteEntry.match(/from ["']([^"']*\/react-dom_client\.js\?[^"']*)["']/)?.[1]
if (!reactUrl || !reactDomUrl) throw new Error('Could not resolve the local Vite React dependency URLs.')
const errors = []
const results = { fixture: 'synthetic UI; no mainnet transactions', devAddress }
const browser = await chromium.launch({
  headless: true,
  // The intercepted local fixture still uses Vite's development-only HMR websocket.
  args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })

await context.route('**/__qa_reinvest', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic reinvestment QA</title></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
await import('/__qa_reinvest_entry.mjs');
</script></body></html>`,
}))
await context.route('**/__qa_reinvest_entry.mjs', (route) => route.fulfill({
  contentType: 'text/javascript',
  body: `
import React from '${reactUrl}';
import ReactDOM from '${reactDomUrl}';
import { RewardReinvestment } from '/src/components/RewardReinvestment.tsx';
import '/src/styles.css';
const root = ReactDOM.createRoot(document.getElementById('root'));
window.ethereum = { request: async ({method}) => {
  if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['${devAddress}'];
  if (method === 'eth_chainId') return '0x1237';
  throw new Error('Synthetic QA wallet cannot sign or submit: ' + method);
}};
window.__qa = { mode: 'success', quotes: 0, executions: 0, confirmations: [], busy: [], renders: 0 };
window.renderReinvest = (overrides = {}, preserveInstance = false) => {
  const metadata = { available: true, reason: 'Synthetic test capability', executor: '0x2222222222222222222222222222222222222222', minimum_muppets_raw: '15000000000000000000000', maximum_deadline_seconds: 300, capability: 'claim_buy_and_bond', version: 1 };
  const props = {
    config: { chainId: 4663, chainName: 'Robinhood Chain', rpcUrl: location.origin + '/api/v1/rpc', explorerUrl: 'https://robinhoodchain.blockscout.com', agentBond: '0x1111111111111111111111111111111111111111' },
    account: '${devAddress}', metadata, positionId: 12n,
    agentKey: '0x3333333333333333333333333333333333333333', claimable: 20000000000000000n,
    availableBoundKeys: 1n, busy: false,
    onBusy: (value) => window.__qa.busy.push(value),
    onConfirmed: (hash) => window.__qa.confirmations.push(hash),
    ...overrides,
  };
  if (!preserveInstance) window.__qa.renders++;
  root.render(React.createElement('main', { className: 'app-page revenue-page', style: { maxWidth: '100%', padding: '16px', boxSizing: 'border-box' } },
    React.createElement(RewardReinvestment, { ...props, key: window.__qa.renders })));
};
window.renderReinvest();`,
}))
await context.route('**/src/lib/reinvest.ts*', (route) => route.fulfill({
  contentType: 'text/javascript',
  body: `
export async function quoteReinvestment({ input }) {
  window.__qa.quotes++;
  if (window.__qa.mode === 'slow-quote') await new Promise((resolve) => { window.__qa.releaseQuote = resolve; });
  if (window.__qa.mode === 'quote-error') throw new Error('Synthetic quote is unavailable. No transaction was sent.');
  return { ...input, quotedOutput: 20000000000000000000000n, minimumOutput: 19800000000000000000000n,
    remainderWeth: 20000000000000000n - input.wethToSpend, nativeGasCost: 210000000000000n,
    expiresAt: Math.floor(Date.now()/1000) + (window.__qa.mode === 'expired' ? -1 : 120) };
}
export async function executeReinvestment({ onSubmitted }) {
  window.__qa.executions++;
  onSubmitted('${submittedHash}');
  if (window.__qa.mode === 'unknown-receipt') throw new Error('Synthetic receipt is not confirmed yet.');
  return { transactionHash: '${submittedHash}', status: 'success' };
}
export async function reconcileReinvestment() {
  throw new Error('Synthetic receipt is not confirmed yet.');
}`,
}))
await context.route('**/api/v1/rpc', (route) => {
  const payload = route.request().postDataJSON()
  const reply = (request) => ({ jsonrpc: '2.0', id: request.id, result: null })
  return route.fulfill({ json: Array.isArray(payload) ? payload.map(reply) : reply(payload) })
})

const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
const quoteButton = () => page.getByRole('button', { name: 'Get quote', exact: true })
const confirmButton = () => page.getByRole('button', { name: 'Confirm buy and stake', exact: true })
async function remount(kind = 'normal') {
  await page.evaluate((mode) => {
    window.localStorage.clear()
    window.__qa.mode = 'success'
    if (mode === 'unavailable') window.renderReinvest({ metadata: { available: false, reason: 'Activation pending.' } })
    else if (mode === 'no-key') window.renderReinvest({ availableBoundKeys: 0n })
    else if (mode === 'no-rewards') window.renderReinvest({ claimable: 0n })
    else window.renderReinvest()
  }, kind)
  await page.waitForTimeout(40)
}
async function prepareQuote() {
  await page.getByRole('textbox', { name: 'WETH to spend' }).fill('0.01')
  await quoteButton().click()
  await page.locator('.reinvest-quote').waitFor()
}

try {
  await page.goto(`${baseUrl}/__qa_reinvest`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Buy more and stake' }).waitFor()
  await prepareQuote()
  const quoteText = await page.locator('.reinvest-quote').innerText()
  assert.match(quoteText, /19800/)
  assert.match(quoteText, /0\.00021 ETH/)
  assert.match(quoteText, /0\.01 WETH/)
  assert.match(quoteText, /15,000/)
  assert.equal(await confirmButton().isDisabled(), true)
  await page.getByRole('checkbox').check()
  assert.equal(await confirmButton().isEnabled(), true)
  await confirmButton().click()
  await page.waitForFunction(() => window.__qa.confirmations.length === 1)
  assert.equal(await page.evaluate(() => window.__qa.executions), 1)
  assert.deepEqual(await page.evaluate(() => window.__qa.busy), [true, false])
  assert.equal(await page.evaluate(() => localStorage.length), 0)
  results.quoteConsentAndSuccess = true

  await remount()
  const invalid = ['0', '-1', '0.03', '1e-3', '0.0000000000000000001', 'abc']
  const quotesBefore = await page.evaluate(() => window.__qa.quotes)
  for (const amount of invalid) {
    await page.getByRole('textbox', { name: 'WETH to spend' }).fill(amount)
    await quoteButton().click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('.reinvest-quote').count(), 0)
  }
  assert.equal(await page.evaluate(() => window.__qa.quotes), quotesBefore)
  results.invalidAmountsRejected = invalid.length

  for (const kind of ['unavailable', 'no-key', 'no-rewards']) {
    await remount(kind)
    assert.equal(await quoteButton().isDisabled(), true)
  }
  results.activationKeyAndRewardsGates = true

  await remount()
  await prepareQuote()
  await page.getByRole('checkbox').check()
  await page.getByLabel('New bond term').selectOption('1')
  assert.equal(await page.locator('.reinvest-quote').count(), 0)
  await quoteButton().click()
  await page.locator('.reinvest-quote').waitFor()
  assert.equal(await page.getByRole('checkbox').isChecked(), false)
  assert.match(await page.locator('.reinvest-quote').innerText(), /90 days/)
  results.changedTermsRequireNewQuoteAndConsent = true

  await remount()
  await page.evaluate(() => { window.__qa.mode = 'slow-quote' })
  await page.getByRole('textbox', { name: 'WETH to spend' }).fill('0.01')
  await quoteButton().click()
  await page.waitForFunction(() => typeof window.__qa.releaseQuote === 'function')
  await page.evaluate(() => window.renderReinvest({ claimable: 0n }, true))
  await page.waitForTimeout(40)
  await page.evaluate(() => window.__qa.releaseQuote())
  await quoteButton().waitFor()
  assert.equal(await page.locator('.reinvest-quote').count(), 0)
  assert.equal(await quoteButton().isDisabled(), true)
  results.inFlightQuoteInvalidatedByRewardChange = true

  await remount()
  await page.evaluate(() => { window.__qa.mode = 'expired' })
  await prepareQuote()
  await page.getByText('Quote expired. Get a fresh quote to continue.').waitFor({ timeout: 3000 })
  assert.equal(await confirmButton().isDisabled(), true)
  assert.equal(await page.getByRole('checkbox').isDisabled(), true)
  results.expiredQuoteBlocked = true

  await remount()
  await page.evaluate(() => { window.__qa.mode = 'quote-error' })
  await quoteButton().click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /No transaction was sent/)
  assert.equal(await quoteButton().isEnabled(), true)
  results.quoteFailureRecoverable = true

  await remount()
  await page.evaluate(() => { window.__qa.mode = 'unknown-receipt' })
  await prepareQuote()
  await page.getByRole('checkbox').check()
  await confirmButton().click()
  await page.getByRole('link', { name: 'View submitted transaction' }).waitFor()
  assert.equal(await quoteButton().isDisabled(), true)
  const sent = await page.evaluate(() => window.__qa.executions)
  await page.getByRole('button', { name: 'Check confirmation' }).click()
  await page.getByText('Confirmation is not available yet. Check the receipt before trying again.').waitFor()
  assert.equal(await quoteButton().isDisabled(), true)
  assert.equal(await page.evaluate(() => window.__qa.executions), sent)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'View submitted transaction' }).waitFor()
  assert.equal(await quoteButton().isDisabled(), true)
  assert.equal(await page.evaluate(() => window.__qa.executions), 0)
  results.pendingReceiptPersistsAndBlocksDuplicates = true

  await remount()
  await prepareQuote()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 980 })
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `overflow at ${width}px`)
  }
  results.desktopAndMobileNoOverflow = true
  assert.deepEqual(errors, [])
  results.consoleErrors = errors
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  console.error(JSON.stringify({ fixtureErrors: errors, pageText: (await page.locator('body').innerText()).slice(0, 600) }))
  throw error
} finally {
  await context.close()
  await browser.close()
}
