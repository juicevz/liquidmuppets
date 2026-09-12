import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, type Address, type Hash } from 'viem'
import fixture from '../../qa/fixtures/stock-drop.json'
import {
  claimStockDrop, pendingStockClaim, reconcileStockClaim, stockDropAbi, stockDropLeaf, verifyStockDropProof,
  type FundedDrop, type StockAllocation, type StockDropState,
} from './stockDrops'

const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(), getBlockNumber: vi.fn(), readContract: vi.fn(), simulateContract: vi.fn(),
  estimateContractGas: vi.fn(), waitForTransactionReceipt: vi.fn(), getTransaction: vi.fn(), getTransactionReceipt: vi.fn(),
}))
vi.mock('viem', async (original) => ({ ...await original<typeof import('viem')>(), createPublicClient: () => rpc }))
const allocation = { ...fixture.allocations[0], claimed: false } as StockAllocation
const account = allocation.account
const hash = `0x${'cd'.repeat(32)}` as Hash
const drop: FundedDrop = {
  id: '0', status: 'funded', token: fixture.reward_token as Address, symbol: 'AAPL', decimals: 18,
  funded_raw: fixture.budget_raw, claimed_raw: '0', remaining_raw: fixture.budget_raw,
  root: fixture.root as Hash, manifest_hash: `0x${'ef'.repeat(32)}`, manifest_url: '/api/v1/stock-drops/0/manifest',
  snapshot_block: fixture.snapshot.block_number, snapshot_hash: fixture.snapshot.block_hash as Hash,
  eligible_wallets: 2, total_units: '3', exclusions: [], allocation,
}
const state: StockDropState = { status: 'available', reason: null, chain_id: 4663, rpc_url: 'http://localhost:8545',
  explorer_url: 'https://example.test', contract: fixture.contract as Address, unit_raw: fixture.unit_raw,
  block_number: 1000, total_drops: 1, next_before: null, wallet: account, drops: [drop] }
let claimed = false
let walletAccount: string = account
let walletChain = '0x1237'
const provider = { request: vi.fn(async ({ method }: { method: string }) => {
  if (method === 'eth_accounts') return [walletAccount]
  if (method === 'eth_chainId') return walletChain
  if (method === 'eth_estimateGas') return '0x186a0'
  if (method === 'eth_sendTransaction') return hash
  throw new Error(`Unexpected method ${method}`)
}) }

beforeEach(() => {
  vi.clearAllMocks()
  claimed = false; walletAccount = account; walletChain = '0x1237'
  rpc.getChainId.mockResolvedValue(4663)
  rpc.getBlockNumber.mockResolvedValue(1000n)
  rpc.readContract.mockImplementation(async ({ functionName }) => ({
    VERSION: 1n, UNIT: BigInt(fixture.unit_raw), MUPPETS: fixture.snapshot.token,
    drops: [fixture.reward_token, BigInt(fixture.budget_raw), 0n, BigInt(drop.snapshot_block), drop.snapshot_hash, drop.root, drop.manifest_hash],
    isClaimed: claimed,
  })[functionName as string])
  rpc.simulateContract.mockResolvedValue({ result: undefined })
  rpc.estimateContractGas.mockResolvedValue(100_000n)
  rpc.waitForTransactionReceipt.mockImplementation(async () => { claimed = true; return { status: 'success' } })
  rpc.getTransactionReceipt.mockResolvedValue({ status: 'success', blockNumber: 1001n, transactionHash: hash })
  rpc.getTransaction.mockResolvedValue({ from: account, to: state.contract, value: 0n,
    input: encodeFunctionData({ abi: stockDropAbi, functionName: 'claim', args: [0n, BigInt(allocation.index), account, BigInt(allocation.amount_raw), allocation.proof] }) })
})

describe('Stock Drops', () => {
  it('verifies Python-generated proofs with the Solidity leaf domain and rejects replay', () => {
    for (const row of fixture.allocations) {
      const claim = { ...row, claimed: false } as StockAllocation
      const leaf = stockDropLeaf(4663, state.contract!, 0n, claim)
      expect(verifyStockDropProof(leaf, claim.proof, fixture.root as Hash)).toBe(true)
      expect(verifyStockDropProof(stockDropLeaf(1, state.contract!, 0n, claim), claim.proof, fixture.root as Hash)).toBe(false)
      expect(verifyStockDropProof(stockDropLeaf(4663, state.contract!, 1n, claim), claim.proof, fixture.root as Hash)).toBe(false)
    }
  })

  it('does not ask the wallet to sign an unfunded or another-wallet allocation', async () => {
    await expect(claimStockDrop({ ...state, status: 'not_configured' }, drop, provider, account, vi.fn())).rejects.toThrow('Refresh')
    await expect(claimStockDrop(state, drop, provider, fixture.allocations[1].account as Address, vi.fn())).rejects.toThrow('Refresh')
    expect(provider.request).not.toHaveBeenCalled()
  })

  it('rejects wrong networks and account changes before a transaction', async () => {
    walletChain = '0x1'
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('Switch your wallet')
    walletChain = '0x1237'
    rpc.simulateContract.mockImplementation(async () => { walletAccount = fixture.allocations[1].account; return {} })
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('active wallet changed')
    expect(provider.request.mock.calls.some(([input]) => input.method === 'eth_sendTransaction')).toBe(false)
  })

  it('rejects a changed contract version without sending', async () => {
    rpc.readContract.mockImplementation(async ({ functionName }) => functionName === 'VERSION' ? 2n : false)
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('evidence does not match')
    expect(provider.request.mock.calls.some(([input]) => input.method === 'eth_sendTransaction')).toBe(false)
  })

  it('rejects a failed simulation without sending', async () => {
    rpc.simulateContract.mockRejectedValue(new Error('issuer transfer restricted'))
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('issuer transfer restricted')
    expect(provider.request.mock.calls.some(([input]) => input.method === 'eth_sendTransaction')).toBe(false)
  })

  it('simulates, sends only a zero-value claim and reconciles the actual receipt', async () => {
    const submitted = vi.fn()
    await expect(claimStockDrop(state, drop, provider, account, submitted)).resolves.toBe(hash)
    expect(submitted).toHaveBeenCalledWith(hash)
    const send = provider.request.mock.calls.find(([input]) => input.method === 'eth_sendTransaction')?.[0]
    expect(send).toMatchObject({ method: 'eth_sendTransaction', params: [{ from: account, to: state.contract, value: '0x0', chainId: '0x1237' }] })
    expect(pendingStockClaim(state, drop.id, account)).toBeNull()
  })

  it('preserves a submitted hash after timeout, blocks duplicates and allows receipt recovery', async () => {
    rpc.waitForTransactionReceipt.mockRejectedValue(new Error('receipt timeout'))
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('receipt timeout')
    expect(pendingStockClaim(state, drop.id, account)).toBe(hash)
    await expect(claimStockDrop(state, drop, provider, account, vi.fn())).rejects.toThrow('already submitted')
    expect(provider.request.mock.calls.filter(([input]) => input.method === 'eth_sendTransaction')).toHaveLength(1)
    claimed = true
    await expect(reconcileStockClaim(state, drop, account)).resolves.toMatchObject({ status: 'success' })
    expect(pendingStockClaim(state, drop.id, account)).toBeNull()
  })
})
