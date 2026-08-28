import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const rpcUrl = process.env.LIQUIDMUPPETS_QA_RPC ?? 'http://127.0.0.1:8545'
const account = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const screenshotDir = new URL('./screenshots/testnet/', import.meta.url)
await mkdir(screenshotDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await context.addInitScript(({ wallet, rpc }) => {
  window.localStorage.setItem('liquidmuppets-handle', '@testkeeper')
  const rpcRequest = async (method, params = []) => {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    const body = await response.json()
    if (body.error) throw new Error(body.error.message)
    return body.result
  }
  window.ethereum = {
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet]
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      return rpcRequest(method, Array.isArray(params) ? params : [])
    },
  }
}, { wallet: account, rpc: rpcUrl })

const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push(error.message))

await page.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
const connectButton = page.getByRole('button', { name: /Connect Rabby/ })
if (await connectButton.count()) await connectButton.click()
await page.getByRole('button', { name: /fox pet/i }).click()
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByText('What should this pet do?').waitFor()
await page.getByRole('button', { name: /Stable yield/ }).click()
await page.getByRole('button', { name: /Continue/ }).click()
await page.getByPlaceholder('quiet fox').fill('test fox')
await page.getByPlaceholder('QFOX').fill('TFOX')
await page.getByRole('button', { name: /Continue/ }).click()
await page.screenshot({ path: new URL('launch-review.png', screenshotDir).pathname, fullPage: true })
await page.getByRole('button', { name: /Launch on testnet/ }).click()
await page.getByText(/Muppet launched/).waitFor({ timeout: 90_000 })

await page.goto(`${baseUrl}/app`, { waitUntil: 'networkidle' })
await page.locator('.live-agent-card').first().click()
await page.getByRole('dialog').waitFor()
await page.screenshot({ path: new URL('agent-before-deposit.png', screenshotDir).pathname, fullPage: false })

await page.getByRole('button', { name: 'Get test asset' }).click()
await page.getByText(/Faucet claim settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Deposit', exact: true }).click()
await page.getByText(/Vault deposit settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(700)

await page.getByRole('button', { name: /Run strategy cycle/ }).click()
await page.getByText(/Agent cycle settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(700)
await page.getByRole('button', { name: 'Transfer into pool' }).click()
await page.getByText(/Test yield transfer settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(700)

await page.getByRole('button', { name: 'buy', exact: true }).click()
await page.getByRole('button', { name: /buy 1 TFOX/i }).click()
await page.getByText(/Key purchase settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'bind', exact: true }).click()
await page.getByRole('button', { name: /bind 1 TFOX/i }).click()
await page.getByText(/Key binding settled/).waitFor({ timeout: 60_000 })
await page.waitForTimeout(700)
await page.screenshot({ path: new URL('agent-after-cycle.png', screenshotDir).pathname, fullPage: false })

const drawerState = await page.getByRole('dialog').evaluate((node) => ({
  overflow: node.scrollWidth > node.clientWidth,
  text: node.textContent ?? '',
}))
await page.getByRole('button', { name: 'Close agent details' }).click()
await page.goto(`${baseUrl}/app/portfolio`, { waitUntil: 'networkidle' })
await page.screenshot({ path: new URL('portfolio.png', screenshotDir).pathname, fullPage: true })

const results = {
  marketRows: await page.locator('.portfolio-agent-row').count(),
  keyRows: await page.locator('.key-holding-row').count(),
  drawerOverflow: drawerState.overflow,
  hasVaultAssets: drawerState.text.includes('100 tUSDG') || drawerState.text.includes('110 tUSDG'),
  hasMuppet: drawerState.text.includes('test fox'),
  consoleErrors,
  pageOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
}
console.log(JSON.stringify(results, null, 2))

await context.close()
await browser.close()

if (
  results.marketRows !== 1
  || results.keyRows !== 1
  || results.drawerOverflow
  || !results.hasMuppet
  || results.consoleErrors.length > 0
  || results.pageOverflow
) process.exitCode = 1
