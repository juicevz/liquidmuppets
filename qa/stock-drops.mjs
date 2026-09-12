// Entirely local integration: synthetic ERC20s at canonical addresses on an ephemeral Anvil chain.
// No private keys, public RPC, mainnet transactions, or real assets are used.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, getAddress } from 'viem'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'muppets-stock-drops-'))
const children = []
let browser
const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject).listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})
const start = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let errors = ''
  child.stderr.on('data', (chunk) => { errors = (errors + chunk.toString()).slice(-3000) })
  child.on('exit', (code) => { if (code && code !== 143) console.error(command, errors) })
  children.push(child)
  return child
}
const waitFor = async (url) => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error(`Local QA service did not start: ${url}`)
}

try {
  execFileSync('forge', ['build', '--skip', 'script'], { cwd: join(root, 'contracts'), stdio: 'pipe' })
  const rpcPort = await freePort()
  const apiPort = await freePort()
  const uiPort = await freePort()
  const rpc = `http://127.0.0.1:${rpcPort}`
  const api = `http://127.0.0.1:${apiPort}`
  const ui = `http://127.0.0.1:${uiPort}`
  start('anvil', ['--host', '127.0.0.1', '--port', String(rpcPort), '--chain-id', '4663', '--silent'])
  const rpcCall = async (method, params = []) => {
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const body = await response.json()
    if (body.error) throw new Error(body.error.message)
    return body.result
  }
  for (let attempt = 0; ; attempt++) {
    try { await rpcCall('eth_chainId'); break } catch (error) {
      if (attempt > 50) throw error
      await new Promise((done) => setTimeout(done, 100))
    }
  }
  const chain = defineChain({ id: 4663, name: 'Local Stock Drop QA', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
  const client = createPublicClient({ chain, transport: http(rpc) })
  const accounts = await rpcCall('eth_accounts')
  const owner = accounts[0]
  const alice = accounts[1]
  const bob = accounts[2]
  const pool = accounts[3]
  const wallet = createWalletClient({ chain, transport: http(rpc), account: owner })
  const muppets = getAddress('0x5e7516be1be5d4396b060908cd44c9db093c4189')
  const stock = getAddress('0xaf3d76f1834a1d425780943c99ea8a608f8a93f9')
  const tokenArtifact = JSON.parse(await readFile(join(root, 'contracts/out/MuppetStockDrops.t.sol/StockDropToken.json')))
  const dropArtifact = JSON.parse(await readFile(join(root, 'contracts/out/MuppetStockDrops.sol/MuppetStockDrops.json')))
  await rpcCall('anvil_setCode', [muppets, tokenArtifact.deployedBytecode.object])
  await rpcCall('anvil_setCode', [stock, tokenArtifact.deployedBytecode.object])
  const tokenAbi = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'])
  const write = async (request) => client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) })
  for (const [account, units] of [[alice, 1n], [bob, 2n], [pool, 10n]]) {
    await write({ address: muppets, abi: tokenAbi, functionName: 'mint', args: [account, units * 15_000n * 10n ** 18n] })
  }
  const snapshot = await client.getBlock()
  await rpcCall('anvil_mine', ['0xc'])
  const deployment = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: dropArtifact.abi,
    bytecode: dropArtifact.bytecode.object, args: [owner, muppets, [stock]] }) })
  const contract = deployment.contractAddress
  const candidates = join(temp, 'holders.json')
  const exclusions = join(temp, 'exclusions.json')
  await writeFile(candidates, JSON.stringify([alice, bob, pool]))
  await writeFile(exclusions, JSON.stringify([{ account: pool.toLowerCase(), reason: 'Local QA pool excluded from holder allocation.' }]))
  // Use the actual archive verifier and allocation builder, then serve that file through the actual API.
  const python = `
import sys
from pathlib import Path
from web3 import Web3
from app.stock_drops_cli import collect_snapshot
from app.services.stock_drop_manifest import build_manifest, canonical_bytes
snapshot = collect_snapshot(Web3(Web3.HTTPProvider(sys.argv[1])), int(sys.argv[2]), Path(sys.argv[3]), None, Path(sys.argv[4]))
manifest = build_manifest(snapshot, sys.argv[5], 0, sys.argv[6], 3 * 10**18)
Path(sys.argv[7]).write_bytes(canonical_bytes(manifest))
`
  execFileSync(join(root, 'backend/.venv/bin/python'), ['-c', python, rpc, String(snapshot.number), candidates, exclusions, contract.toLowerCase(), stock.toLowerCase(), join(temp, '0.json')], { cwd: join(root, 'backend') })
  const manifest = JSON.parse(await readFile(join(temp, '0.json')))
  const { keccak256 } = await import('viem')
  const manifestHash = keccak256(new Uint8Array(await readFile(join(temp, '0.json'))))
  start(join(root, 'backend/.venv/bin/uvicorn'), ['app.main:app', '--host', '127.0.0.1', '--port', String(apiPort)], {
    cwd: join(root, 'backend'), env: { ...process.env, FACTORY_ADDRESS: '', CHAIN_ID: '4663', RPC_URL: rpc,
      RPC_FALLBACK_URLS: '', STOCK_DROPS_ADDRESS: contract, STOCK_DROPS_MANIFEST_DIR: temp,
      DATABASE_PATH: join(temp, 'qa.sqlite'), AUTO_KEEPER_ENABLED: 'false', KEEPER_PRIVATE_KEY: '', BROWSER_RPC_URL: '/api/v1/rpc' },
  })
  start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(uiPort)], {
    env: { ...process.env, LIQUIDMUPPETS_API_PROXY: api },
  })
  await waitFor(`${api}/api/v1/stock-drops`)
  await waitFor(ui)
  browser = await chromium.launch({ headless: true })
  const disconnected = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  await disconnected.goto(`${ui}/app/stock-drops`)
  await disconnected.getByRole('heading', { name: 'Waiting for a funded pot.' }).waitFor()
  assert.equal(await disconnected.getByRole('button', { name: 'Claim AAPL', exact: true }).count(), 0)
  await disconnected.screenshot({ path: join(temp, 'unfunded-desktop.png'), fullPage: true })
  await write({ address: stock, abi: tokenAbi, functionName: 'mint', args: [owner, 3n * 10n ** 18n] })
  await write({ address: stock, abi: tokenAbi, functionName: 'approve', args: [contract, 3n * 10n ** 18n] })
  await write({ address: contract, abi: dropArtifact.abi, functionName: 'fundDrop', args: [0n, stock, 3n * 10n ** 18n,
    snapshot.number, snapshot.hash, manifest.root, manifestHash] })
  const data = await (await fetch(`${api}/api/v1/stock-drops?wallet=${alice}`)).json()
  assert.equal(data.drops[0].status, 'funded')
  assert.equal(data.drops[0].allocation.amount_raw, '1000000000000000000')
  let sends = 0
  const connectedPage = async (account, viewport) => {
    const page = await browser.newPage({ viewport })
    await page.exposeFunction('qaRpc', async (method, params) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account]
      if (method === 'wallet_switchEthereumChain') return null
      if (method === 'eth_sendTransaction') sends++
      return rpcCall(method, params ?? [])
    })
    await page.addInitScript(() => {
      window.ethereum = { request: ({ method, params }) => method === 'eth_chainId' && window.qaWrongChain
        ? Promise.resolve('0x1') : window.qaRpc(method, params) }
    })
    return page
  }
  const page = await connectedPage(alice, { width: 1440, height: 1100 })
  await page.goto(`${ui}/app/stock-drops`)
  await page.getByRole('button', { name: 'Claim AAPL', exact: true }).waitFor()
  await page.screenshot({ path: join(temp, 'funded-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Claim AAPL', exact: true }).click()
  await Promise.race([
    page.getByRole('link', { name: 'Confirmed receipt' }).waitFor({ timeout: 60_000 }),
    page.getByRole('alert').waitFor({ timeout: 60_000 }).then(async () => {
      throw new Error(`Claim UI failed: ${await page.getByRole('alert').innerText()}`)
    }),
  ])
  assert.equal(await client.readContract({ address: stock, abi: tokenAbi, functionName: 'balanceOf', args: [alice] }), 10n ** 18n)
  assert.equal(sends, 1)
  await page.reload()
  await page.getByRole('button', { name: 'Claimed', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Claimed', exact: true }).isDisabled())
  const mobile = await connectedPage(bob, { width: 390, height: 844 })
  await mobile.goto(`${ui}/app/stock-drops`)
  await mobile.getByRole('button', { name: 'Claim AAPL', exact: true }).waitFor()
  await mobile.evaluate(() => { window.qaWrongChain = true })
  await mobile.getByRole('button', { name: 'Claim AAPL', exact: true }).click()
  await mobile.getByRole('alert').filter({ hasText: 'Switch your wallet to Robinhood Chain' }).waitFor()
  assert.equal(sends, 1)
  await mobile.screenshot({ path: join(temp, 'funded-mobile.png'), fullPage: true })
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 })
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}`)
  }
  await rename(join(temp, '0.json'), join(temp, 'offline.json'))
  await mobile.reload()
  await mobile.getByRole('heading', { name: 'Drop #0 is unavailable.' }).waitFor()
  assert.equal(await mobile.getByRole('button', { name: 'Claim AAPL', exact: true }).count(), 0)
  await rename(join(temp, 'offline.json'), join(temp, '0.json'))
  await disconnected.goto(`${ui}/docs#stock-drops`)
  await disconnected.getByRole('heading', { name: 'Stock Drops for $MUPPETS holders', exact: true }).waitFor()
  assert.equal(await disconnected.getByRole('link', { name: 'Open Stock Drops', exact: true }).getAttribute('href'), '/app/stock-drops')
  console.log(JSON.stringify({ status: 'passed', environment: 'local synthetic Anvil, no mainnet funds',
    verified: ['unfunded state', 'Python snapshot to Solidity Merkle proof', 'actual API evidence', 'browser wallet claim',
      'exact ERC20 receipt', 'duplicate claim disabled', 'wrong network rejected before send', 'missing manifest fails closed', '390px and 320px'],
    transactionsFromHolder: sends, screenshotDirectory: temp }, null, 2))
} finally {
  await browser?.close()
  for (const child of children.reverse()) child.kill('SIGTERM')
  if (process.env.STOCK_DROPS_QA_CLEAN === '1') await rm(temp, { recursive: true, force: true })
}
