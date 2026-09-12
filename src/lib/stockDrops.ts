import {
  createPublicClient, defineChain, encodeAbiParameters, encodeFunctionData, http, isAddress,
  keccak256, parseAbi, toHex, concatHex, type Address, type Hash,
} from 'viem'
import type { WalletProvider } from '../types'

export const STOCK_DROP_UNIT = 15_000n * 10n ** 18n
const MUPPETS = '0x5e7516be1be5d4396b060908cd44c9db093c4189'
const stockTokens = new Set([
  '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc',
  '0x12f190a9f9d7d37a250758b26824b97ce941bf54', '0x47f93d52cbec7c6d2cfc080e154002370a60daea',
])
export const stockDropAbi = parseAbi([
  'function VERSION() view returns (uint256)',
  'function UNIT() view returns (uint256)',
  'function MUPPETS() view returns (address)',
  'function drops(uint256) view returns (address token, uint256 funded, uint256 claimed, uint256 snapshotBlock, bytes32 snapshotHash, bytes32 root, bytes32 manifestHash)',
  'function liability(address) view returns (uint256)',
  'function isClaimed(uint256, uint256) view returns (bool)',
  'function claim(uint256 dropId, uint256 index, address account, uint256 amount, bytes32[] proof)',
  'event Claimed(uint256 indexed dropId, uint256 indexed index, address indexed account, uint256 amount)',
])

export interface StockAllocation {
  index: number
  account: Address
  units: string
  amount_raw: string
  proof: Hash[]
  claimed: boolean
}
export interface FundedDrop {
  id: string
  status: 'funded'
  token: Address
  symbol: string
  decimals: 18
  funded_raw: string
  claimed_raw: string
  remaining_raw: string
  root: Hash
  manifest_hash: Hash
  manifest_url: string
  snapshot_block: number
  snapshot_hash: Hash
  eligible_wallets: number
  total_units: string
  exclusions: Array<{ account: Address; reason: string }>
  allocation: StockAllocation | null
}
export type StockDrop = FundedDrop | { id: string; status: 'unavailable'; reason: string; allocation: null }
export interface StockDropState {
  status: 'not_configured' | 'unavailable' | 'available'
  reason: string | null
  chain_id: number
  rpc_url: string
  explorer_url: string
  contract: Address | null
  unit_raw: string
  block_number: number | null
  total_drops: number | null
  next_before: number | null
  wallet: string | null
  drops: StockDrop[]
}

export async function fetchStockDrops(wallet?: string, before?: number): Promise<StockDropState> {
  const query = new URLSearchParams()
  if (wallet) query.set('wallet', wallet)
  if (before !== undefined) query.set('before', String(before))
  const response = await fetch(`/api/v1/stock-drops?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Stock Drop evidence is unavailable. Try refreshing.')
  return response.json() as Promise<StockDropState>
}

export function stockDropLeaf(chainId: number, contract: Address, id: bigint, allocation: StockAllocation): Hash {
  return keccak256(keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
    [BigInt(chainId), contract, id, BigInt(allocation.index), allocation.account, BigInt(allocation.amount_raw)],
  )))
}

export function verifyStockDropProof(leaf: Hash, proof: readonly Hash[], root: Hash): boolean {
  return proof.reduce((node, sibling) => keccak256(concatHex([node, sibling].sort() as [Hash, Hash])), leaf) === root
}

function context(state: StockDropState, drop: FundedDrop, account: Address) {
  const allocation = drop.allocation
  if (state.status !== 'available' || state.chain_id !== 4663 || !state.contract || !isAddress(state.contract)
    || state.unit_raw !== STOCK_DROP_UNIT.toString() || !allocation || allocation.account.toLowerCase() !== account.toLowerCase()
    || state.wallet?.toLowerCase() !== account.toLowerCase() || !stockTokens.has(drop.token.toLowerCase())
    || !Number.isSafeInteger(allocation.index) || allocation.index < 0 || allocation.index >= 10_000
    || !/^(0|[1-9]\d*)$/.test(drop.id) || !/^[1-9]\d*$/.test(allocation.amount_raw)
    || BigInt(allocation.amount_raw) >= 2n ** 256n || allocation.proof.length > 32) {
    throw new Error('Refresh the allocation for the connected wallet before claiming.')
  }
  if (!verifyStockDropProof(stockDropLeaf(state.chain_id, state.contract, BigInt(drop.id), allocation), allocation.proof, drop.root)) {
    throw new Error('The allocation proof does not match this drop.')
  }
  const chain = defineChain({ id: 4663, name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [state.rpc_url] } } })
  const client = createPublicClient({ chain, transport: http(state.rpc_url, {
    retryCount: 1, fetchOptions: { headers: { 'X-LiquidMuppets-Fresh': '1' } },
  }) })
  const args = [BigInt(drop.id), BigInt(allocation.index), account, BigInt(allocation.amount_raw), allocation.proof] as const
  return { client, contract: state.contract, allocation, args,
    data: encodeFunctionData({ abi: stockDropAbi, functionName: 'claim', args }) }
}

const pending = new Map<string, Hash>()
const preparing = new Set<string>()
function storageKey(state: StockDropState, id: string, account: string): string {
  return `muppets-stock-drop:${state.chain_id}:${state.contract?.toLowerCase()}:${id}:${account.toLowerCase()}`
}
export function pendingStockClaim(state: StockDropState, id: string, account: string): Hash | null {
  const key = storageKey(state, id, account)
  if (pending.has(key)) return pending.get(key)!
  try {
    const saved = localStorage.getItem(key)
    if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) return saved as Hash
  } catch { /* The in-memory submission guard remains available. */ }
  return null
}
function remember(key: string, hash: Hash | null) {
  if (hash) pending.set(key, hash)
  else pending.delete(key)
  try {
    if (hash) localStorage.setItem(key, hash)
    else localStorage.removeItem(key)
  } catch { /* Browser storage is optional. */ }
}

async function assertWallet(provider: WalletProvider, account: Address) {
  const [accounts, chainId] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ])
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== account.toLowerCase()) {
    throw new Error('The active wallet changed. Reconnect and refresh your allocation.')
  }
  if (chainId !== toHex(4663)) throw new Error('Switch your wallet to Robinhood Chain before claiming.')
}

export async function claimStockDrop(state: StockDropState, drop: FundedDrop, provider: WalletProvider,
  account: Address, onSubmitted: (hash: Hash) => void): Promise<Hash> {
  const key = storageKey(state, drop.id, account)
  if (preparing.has(key) || pendingStockClaim(state, drop.id, account)) {
    throw new Error('A claim is already submitted or awaiting your wallet. Check its confirmation first.')
  }
  preparing.add(key)
  try {
    const { client, contract, allocation, args, data } = context(state, drop, account)
    await assertWallet(provider, account)
    if (await client.getChainId() !== 4663) throw new Error('RPC chain mismatch.')
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
    const [version, unit, muppets, chainDrop, claimed] = await Promise.all([
      client.readContract({ address: contract, abi: stockDropAbi, functionName: 'VERSION', blockNumber }),
      client.readContract({ address: contract, abi: stockDropAbi, functionName: 'UNIT', blockNumber }),
      client.readContract({ address: contract, abi: stockDropAbi, functionName: 'MUPPETS', blockNumber }),
      client.readContract({ address: contract, abi: stockDropAbi, functionName: 'drops', args: [BigInt(drop.id)], blockNumber }),
      client.readContract({ address: contract, abi: stockDropAbi, functionName: 'isClaimed', args: [BigInt(drop.id), BigInt(allocation.index)], blockNumber }),
    ])
    if (version !== 1n || unit !== STOCK_DROP_UNIT || muppets.toLowerCase() !== MUPPETS
      || chainDrop[0].toLowerCase() !== drop.token.toLowerCase() || chainDrop[1] !== BigInt(drop.funded_raw)
      || chainDrop[3] !== BigInt(drop.snapshot_block) || chainDrop[4] !== drop.snapshot_hash
      || chainDrop[5] !== drop.root || chainDrop[6] !== drop.manifest_hash) throw new Error('The funded drop changed or its evidence does not match.')
    if (claimed) throw new Error('This allocation is already claimed.')
    await client.simulateContract({ address: contract, abi: stockDropAbi, functionName: 'claim', args, account })
    const estimate = await provider.request({ method: 'eth_estimateGas', params: [{ from: account, to: contract, data, value: '0x0' }] })
    if (typeof estimate !== 'string' || !/^0x[0-9a-f]+$/i.test(estimate) || BigInt(estimate) <= 0n) {
      throw new Error('The wallet did not return a valid gas estimate.')
    }
    const gas = BigInt(estimate)
    await assertWallet(provider, account)
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{
      from: account, to: contract, data, value: '0x0', chainId: toHex(4663), gas: toHex(gas * 12n / 10n),
    }] }) as Hash
    remember(key, hash)
    onSubmitted(hash)
    // Save the hash before waiting. A timeout must never cause an automatic second transaction.
    await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 40_000 })
    const receipt = await reconcileStockClaim(state, drop, account)
    if (receipt.status !== 'success') throw new Error('The claim reverted. Your allocation is still available; network gas was charged.')
    return hash
  } finally {
    preparing.delete(key)
  }
}

export async function reconcileStockClaim(state: StockDropState, drop: FundedDrop, account: Address) {
  const hash = pendingStockClaim(state, drop.id, account)
  if (!hash) throw new Error('No submitted claim found.')
  const { client, contract, data, allocation } = context(state, drop, account)
  const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })])
  if (transaction.to?.toLowerCase() !== contract.toLowerCase() || transaction.from.toLowerCase() !== account.toLowerCase()
    || transaction.input.toLowerCase() !== data.toLowerCase() || transaction.value !== 0n) {
    throw new Error('The receipt does not match this claim.')
  }
  if (receipt.status === 'success' && !await client.readContract({ address: contract, abi: stockDropAbi,
    functionName: 'isClaimed', args: [BigInt(drop.id), BigInt(allocation.index)], blockNumber: receipt.blockNumber })) {
    throw new Error('The confirmed receipt did not settle this claim.')
  }
  remember(storageKey(state, drop.id, account), null)
  return receipt
}
