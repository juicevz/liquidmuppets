import { chromium } from 'playwright'
import { createPublicClient, defineChain, http } from 'viem'

const baseUrl = process.env.LIQUIDMUPPETS_QA_URL ?? 'http://127.0.0.1:4317'
const rpcUrl = process.env.LIQUIDMUPPETS_QA_RPC ?? 'http://127.0.0.1:18545'
const account = (process.env.LIQUIDMUPPETS_QA_ACCOUNT ?? '0x30dF6f545FcD732c659626b8C8aFd63Ff8aE3d5f').toLowerCase()
const factory = process.env.LIQUIDMUPPETS_QA_FACTORY ?? '0x570F0FEBFE8b33F37D01f7153F0F85E59FfcE460'

const factoryAbi = [{
  type: 'function',
  name: 'agentCount',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ type: 'uint256' }],
}]

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const body = await response.json()
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `RPC ${response.status}`)
  return body.result
}

await rpc('anvil_setBalance', [account, '0x3635c9adc5dea00000'])
await rpc('anvil_impersonateAccount', [account])

const chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const client = createPublicClient({ chain, transport: http(rpcUrl) })
const before = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'agentCount' })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })
await context.addInitScript(({ wallet, rpcEndpoint }) => {
  const rpcRequest = async (method, params = []) => {
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    const body = await response.json()
    if (!response.ok || body.error) throw body.error ?? new Error(`RPC ${response.status}`)
    return body.result
  }

  window.ethereum = {
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet]
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      return rpcRequest(method, Array.isArray(params) ? params : [])
    },
  }
}, { wallet: account, rpcEndpoint: rpcUrl })

const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push(error.message))

const suffix = Date.now().toString().slice(-6)
const muppetName = `fork plum ${suffix}`

try {
  await page.goto(`${baseUrl}/app/create`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /plum pet/i }).click()
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByText('What should this pet do?').waitFor()

  const taskCount = await page.locator('.task-picker button').count()
  await page.getByRole('button', { name: /Launch pool/i }).click()
  const launchPoolSelected = await page.getByRole('button', { name: /Launch pool/i }).getAttribute('aria-pressed')
  await page.getByRole('button', { name: /ETH range/i }).click()
  const ethRangeSelected = await page.getByRole('button', { name: /ETH range/i }).getAttribute('aria-pressed')

  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByPlaceholder('quiet fox').fill(muppetName)
  await page.getByPlaceholder('QFOX').fill(`F${suffix}`)
  await page.getByRole('button', { name: /Continue/ }).click()
  await page.getByRole('button', { name: 'Launch Muppet' }).click()
  await page.getByText(/Muppet launched\. Vault, Key, and first ask are live\./).waitFor({ timeout: 120_000 })

  const after = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'agentCount' })
  await page.getByRole('button', { name: 'Marketplace' }).click()
  await page.getByText(muppetName, { exact: true }).first().waitFor({ timeout: 30_000 })

  const results = {
    devAddress: account,
    taskCount,
    launchPoolSelected: launchPoolSelected === 'true',
    ethRangeSelected: ethRangeSelected === 'true',
    agentCountBefore: Number(before),
    agentCountAfter: Number(after),
    createdAgentVisible: await page.getByText(muppetName, { exact: true }).count() > 0,
    consoleErrors,
  }
  console.log(JSON.stringify(results, null, 2))

  if (
    results.taskCount !== 3
    || !results.launchPoolSelected
    || !results.ethRangeSelected
    || results.agentCountAfter !== results.agentCountBefore + 1
    || !results.createdAgentVisible
    || results.consoleErrors.length > 0
  ) process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
  await rpc('anvil_stopImpersonatingAccount', [account])
}
