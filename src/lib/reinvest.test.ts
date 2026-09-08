import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { decodeFunctionData, encodeFunctionData, parseEther, type Address, type TransactionReceipt } from 'viem'
import type { ProtocolConfig } from './api'
import type { WalletProvider } from '../types'
import {
  executeReinvestment, parseReinvestmentUnits, parseReinvestmentWeth, quoteReinvestment, reconcileReinvestment,
  REINVESTMENT_UNIT, validateReinvestmentQuote,
  type ReinvestmentInput, type ReinvestmentMetadata,
} from './reinvest'

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(), simulateContract: vi.fn(), getChainId: vi.fn(),
  getTransaction: vi.fn(), getTransactionReceipt: vi.fn(),
  waitForTransactionReceipt: vi.fn(), createProtocolClient: vi.fn(),
}))

vi.mock('./protocol', () => ({
  createProtocolClient: mocks.createProtocolClient,
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return { ...actual, createPublicClient: vi.fn(() => ({ waitForTransactionReceipt: mocks.waitForTransactionReceipt })) }
})

const account = '0x1111111111111111111111111111111111111111' as Address
const bond = '0x2222222222222222222222222222222222222222' as Address
const key = '0x3333333333333333333333333333333333333333' as Address
const executor = '0x4444444444444444444444444444444444444444' as Address
const muppets = '0x5555555555555555555555555555555555555555' as Address
const weth = '0x6666666666666666666666666666666666666666' as Address
const otherAccount = '0x7777777777777777777777777777777777777777' as Address
const hash = `0x${'a'.repeat(64)}` as const
const config = {
  chainId: 4663, chainName: 'Robinhood', rpcUrl: '/api/v1/rpc', explorerUrl: 'https://example.test',
  agentBond: bond, WETH: weth, accessGate: { tokenAddress: muppets },
} as ProtocolConfig
const input: ReinvestmentInput = { positionId: 1n, key, units: 1n, term: 0, wethToSpend: parseEther('0.1') }
const metadata: ReinvestmentMetadata = { available: true, executor }
const receipt = { status: 'success', transactionHash: hash } as TransactionReceipt
let contractState: Record<string, unknown>
let providerRequest: Mock<WalletProvider['request']>
let provider: WalletProvider

function request(overrides: Partial<{ config: ProtocolConfig; account: Address; metadata: ReinvestmentMetadata; input: ReinvestmentInput; provider: WalletProvider }> = {}) {
  return { config, account, metadata, input, provider, ...overrides }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  contractState = {
    REINVESTMENT_VERSION: 1n, REWARD_BUY_EXECUTOR: executor, MUPPETS: muppets, WETH: weth,
    UNIT_SIZE: REINVESTMENT_UNIT, paused: false,
    pendingPositionRewards: [parseEther('0.2'), parseEther('0.1')], availableBoundKeys: 1n,
  }
  mocks.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => contractState[functionName])
  mocks.getChainId.mockResolvedValue(4663)
  mocks.simulateContract.mockResolvedValue({ result: [2n, parseEther('20000'), parseEther('0.2'), parseEther('0.1')] })
  mocks.waitForTransactionReceipt.mockResolvedValue(receipt)
  mocks.getTransactionReceipt.mockResolvedValue(receipt)
  mocks.getTransaction.mockImplementation(async () => ({
    from: account, to: bond, input: encodeFunctionData(mocks.simulateContract.mock.calls.at(-1)![0]),
  }))
  mocks.createProtocolClient.mockReturnValue({
    readContract: mocks.readContract, simulateContract: mocks.simulateContract, getChainId: mocks.getChainId,
    getTransaction: mocks.getTransaction, getTransactionReceipt: mocks.getTransactionReceipt,
    chain: { id: 4663 },
  })
  providerRequest = vi.fn(async ({ method }: { method: string; params?: unknown[] | object }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x1237'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_getBalance') return `0x${parseEther('1').toString(16)}`
    if (method === 'eth_sendTransaction') return hash
    throw new Error(`Unexpected wallet method: ${method}`)
  })
  provider = { request: providerRequest }
})

describe('reinvestment input and quote protection', () => {
  it('parses decimal WETH exactly and keeps unit calculations in bigint', () => {
    expect(parseReinvestmentWeth('0.000000000000000001')).toBe(1n)
    expect(parseReinvestmentWeth('0.02')).toBe(20_000_000_000_000_000n)
    expect(parseReinvestmentUnits('9007199254740993')).toBe(9_007_199_254_740_993n)
    for (const invalid of ['0', '-1', '1e3', ' 1', '1.0000000000000000001', '.1', 'NaN']) {
      expect(() => parseReinvestmentWeth(invalid)).toThrow()
    }
    for (const invalid of ['0', '1.2', '-1', '01', '1e2', (1n << 128n).toString()]) {
      expect(() => parseReinvestmentUnits(invalid)).toThrow()
    }
  })

  it('fails closed while activation metadata is pending without touching RPC or the wallet', async () => {
    await expect(quoteReinvestment(request({ metadata: { available: false, executor: null } }))).rejects.toThrow('not active')
    expect(mocks.createProtocolClient).not.toHaveBeenCalled()
    expect(providerRequest).not.toHaveBeenCalled()
  })

  it('quotes the real atomic call with one percent slippage, complete identity and native gas', async () => {
    const quote = await quoteReinvestment(request())
    expect(mocks.createProtocolClient).toHaveBeenCalledWith(config, { fresh: true })
    expect(mocks.simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: bond, account, functionName: 'claimBuyAndBond',
      args: [1n, parseEther('0.1'), key, 1n, 0, REINVESTMENT_UNIT, 1_800_000_120n],
    }))
    expect(quote).toMatchObject({
      chainId: 4663, account, bond, executor, key, positionId: 1n, units: 1n, term: 0,
      wethToSpend: parseEther('0.1'), quotedOutput: parseEther('20000'), minimumOutput: parseEther('19800'),
      bondAmount: REINVESTMENT_UNIT, remainderWeth: parseEther('0.2'), slippageBps: 100,
      createdAt: 1_800_000_000, expiresAt: 1_800_000_120, deadline: 1_800_000_120,
      estimatedGas: 100_000n, gasLimit: 120_000n, gasPrice: 1_000_000_000n, nativeGasCost: 120_000_000_000_000n,
    })
    expect(Object.isFrozen(quote)).toBe(true)
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it('never allows slippage to lower minimum output below a complete bond unit', async () => {
    mocks.simulateContract.mockResolvedValue({ result: [2n, parseEther('15001'), parseEther('0.2'), parseEther('0.1')] })
    expect((await quoteReinvestment(request())).minimumOutput).toBe(REINVESTMENT_UNIT)
    mocks.simulateContract.mockResolvedValue({ result: [2n, REINVESTMENT_UNIT - 1n, parseEther('0.2'), parseEther('0.1')] })
    await expect(quoteReinvestment(request())).rejects.toThrow('Claim WETH or wait')
  })

  it.each([-1, 301, 1.5, Number.NaN])('rejects invalid slippage %s before RPC', async (slippageBps) => {
    await expect(quoteReinvestment(request({ input: { ...input, slippageBps } }))).rejects.toThrow('between 0% and 3%')
    expect(mocks.createProtocolClient).not.toHaveBeenCalled()
  })

  it('rejects overspending existing rewards, insufficient Key capacity and missing native gas', async () => {
    await expect(quoteReinvestment(request({ input: { ...input, wethToSpend: parseEther('0.31') } }))).rejects.toThrow('claimable WETH')
    contractState.availableBoundKeys = 0n
    await expect(quoteReinvestment(request())).rejects.toThrow('unused permanently bound')
    contractState.availableBoundKeys = 1n
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => call.method === 'eth_getBalance' ? Promise.resolve('0x0') : original(call))
    await expect(quoteReinvestment(request())).rejects.toThrow('native ETH for gas')
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it.each(['REINVESTMENT_VERSION', 'REWARD_BUY_EXECUTOR', 'MUPPETS', 'WETH', 'UNIT_SIZE', 'paused'])('requires current %s to match the verified configuration', async (getter) => {
    contractState[getter] = getter === 'REINVESTMENT_VERSION' || getter === 'UNIT_SIZE' ? 2n : getter === 'paused' ? true : otherAccount
    await expect(quoteReinvestment(request())).rejects.toThrow('does not match')
    expect(mocks.simulateContract).not.toHaveBeenCalled()
  })

  it('invalidates quotes after any position, Key, amount, term, wallet, chain or route change', async () => {
    const quote = await quoteReinvestment(request())
    const changedInputs: Partial<ReinvestmentInput>[] = [
      { positionId: 2n }, { key: otherAccount }, { units: 2n }, { term: 1 }, { wethToSpend: 1n }, { slippageBps: 200 },
    ]
    for (const change of changedInputs) expect(() => validateReinvestmentQuote(request({ input: { ...input, ...change } }), quote)).toThrow('changed')
    expect(() => validateReinvestmentQuote(request({ account: otherAccount }), quote)).toThrow('changed')
    expect(() => validateReinvestmentQuote(request({ config: { ...config, chainId: 1 } }), quote)).toThrow('changed')
    expect(() => validateReinvestmentQuote(request({ config: { ...config, agentBond: otherAccount } }), quote)).toThrow('changed')
    expect(() => validateReinvestmentQuote(request({ metadata: { available: true, executor: otherAccount } }), quote)).toThrow('changed')
    expect(() => validateReinvestmentQuote(request(), { ...quote, minimumOutput: 1n })).toThrow('protected output')
    expect(() => validateReinvestmentQuote(request(), { ...quote, deadline: quote.createdAt + 301 })).toThrow('deadline')
    vi.mocked(Date.now).mockReturnValue(1_800_000_120_000)
    expect(() => validateReinvestmentQuote(request(), quote)).toThrow('expired')
  })
})

describe('reinvestment execution', () => {
  it('re-simulates exact protected calldata and submits one zero-value transaction with no approvals', async () => {
    const quote = await quoteReinvestment(request())
    const onSubmitted = vi.fn()
    expect(await executeReinvestment({ ...request(), quote, onSubmitted })).toBe(receipt)
    expect(mocks.simulateContract).toHaveBeenLastCalledWith(expect.objectContaining({
      args: [1n, input.wethToSpend, key, 1n, 0, quote.minimumOutput, BigInt(quote.deadline)],
    }))
    const sends = providerRequest.mock.calls.filter(([call]) => call.method === 'eth_sendTransaction')
    expect(sends).toHaveLength(1)
    const sent = (sends[0][0].params as [{ from: Address; to: Address; value: string; gas: string; gasPrice: string; data: `0x${string}` }])[0]
    expect(sent).toMatchObject({ from: account, to: bond, value: '0x0', gas: '0x1d4c0', gasPrice: '0x3b9aca00' })
    const abi = mocks.simulateContract.mock.calls.at(-1)![0].abi
    const decoded = decodeFunctionData({ abi, data: sent.data })
    expect(decoded.functionName).toBe('claimBuyAndBond')
    expect(onSubmitted).toHaveBeenCalledWith(hash)
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith({ hash, confirmations: 1, timeout: 60_000 })
  })

  it.each(['wallet', 'chain'])('blocks a %s change after quoting', async (change) => {
    const quote = await quoteReinvestment(request())
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => {
      if (change === 'wallet' && call.method === 'eth_accounts') return Promise.resolve([otherAccount])
      if (change === 'chain' && call.method === 'eth_chainId') return Promise.resolve('0x1')
      return original(call)
    })
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('changed')
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it('checks the wallet again after execution preflight and before submission', async () => {
    const quote = await quoteReinvestment(request())
    let checks = 0
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => {
      if (call.method === 'eth_accounts') return Promise.resolve([++checks === 1 ? account : otherAccount])
      return original(call)
    })
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('wallet changed')
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it('does not send if fresh simulation fails or rewards or Key capacity were consumed', async () => {
    const quote = await quoteReinvestment(request())
    mocks.simulateContract.mockRejectedValueOnce(new Error('price moved'))
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('Nothing was sent')
    contractState.pendingPositionRewards = [0n, 0n]
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('claimable WETH')
    contractState.pendingPositionRewards = [parseEther('1'), 0n]
    contractState.availableBoundKeys = 0n
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('unused permanently bound')
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it('requires re-quoting an increased gas estimate', async () => {
    const quote = await quoteReinvestment(request())
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => call.method === 'eth_gasPrice' ? Promise.resolve('0x77359400') : original(call))
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('network-fee estimate increased')
    expect(providerRequest.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
  })

  it('blocks duplicate submissions while confirmation is pending', async () => {
    const quote = await quoteReinvestment(request())
    let releaseReceipt!: (value: TransactionReceipt) => void
    mocks.waitForTransactionReceipt.mockImplementation(() => new Promise<TransactionReceipt>((resolve) => { releaseReceipt = resolve }))
    const execution = executeReinvestment({ ...request(), quote })
    await vi.waitFor(() => expect(mocks.waitForTransactionReceipt).toHaveBeenCalled())
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('already pending')
    releaseReceipt(receipt)
    await expect(execution).resolves.toBe(receipt)
    expect(providerRequest.mock.calls.filter(([call]) => call.method === 'eth_sendTransaction')).toHaveLength(1)
  })

  it('verifies receipt success and keeps ordinary claim available after a revert', async () => {
    const quote = await quoteReinvestment(request())
    mocks.waitForTransactionReceipt.mockResolvedValueOnce({ ...receipt, status: 'reverted' })
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('reverted')
    await expect(executeReinvestment({ ...request(), quote })).resolves.toBe(receipt)
  })

  it('only clears a timed-out submission after verifying its confirmed wallet, bond and position receipt', async () => {
    const quote = await quoteReinvestment(request())
    mocks.waitForTransactionReceipt.mockRejectedValue(new Error('receipt timeout'))
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow(`Transaction ${hash} was submitted`)
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('already pending')
    expect(providerRequest.mock.calls.filter(([call]) => call.method === 'eth_sendTransaction')).toHaveLength(1)
    await expect(reconcileReinvestment({ config, account, hash, positionId: 9n })).rejects.toThrow('expected buy-and-bond position')
    await expect(reconcileReinvestment({ config, account: otherAccount, hash, positionId: 1n })).rejects.toThrow('pending wallet and bond')
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('already pending')
    await expect(reconcileReinvestment({ config, account, hash, positionId: 1n })).resolves.toBe(receipt)
    mocks.waitForTransactionReceipt.mockResolvedValue(receipt)
    await expect(executeReinvestment({ ...request(), quote })).resolves.toBe(receipt)
  })

  it('reconciles reverted receipts but rejects a non-reinvestment transaction', async () => {
    await quoteReinvestment(request())
    mocks.getTransactionReceipt.mockResolvedValue({ ...receipt, status: 'reverted' })
    await expect(reconcileReinvestment({ config, account, hash, positionId: 1n })).resolves.toMatchObject({ status: 'reverted' })
    mocks.getTransaction.mockResolvedValue({
      from: account, to: bond,
      input: encodeFunctionData({
        abi: [{ type: 'function', name: 'MUPPETS', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
        functionName: 'MUPPETS',
      }),
    })
    await expect(reconcileReinvestment({ config, account, hash, positionId: 1n })).rejects.toThrow('expected buy-and-bond position')
  })

  it('allows an explicit wallet rejection to be retried without sending another request automatically', async () => {
    const quote = await quoteReinvestment(request())
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => {
      if (call.method === 'eth_sendTransaction') return Promise.reject({ code: 4001, message: 'User rejected' })
      return original(call)
    })
    await expect(executeReinvestment({ ...request(), quote })).rejects.toMatchObject({ code: 4001 })
    providerRequest.mockImplementation(original)
    await expect(executeReinvestment({ ...request(), quote })).resolves.toBe(receipt)
  })

  it('guards an ambiguous wallet send failure instead of risking duplicate submission', async () => {
    const quote = await quoteReinvestment(request())
    const original = providerRequest.getMockImplementation()!
    providerRequest.mockImplementation((call) => {
      if (call.method === 'eth_sendTransaction') return Promise.reject(new Error('transport disconnected'))
      return original(call)
    })
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('whether this transaction was submitted')
    await expect(executeReinvestment({ ...request(), quote })).rejects.toThrow('already pending')
    expect(providerRequest.mock.calls.filter(([call]) => call.method === 'eth_sendTransaction')).toHaveLength(1)
  })
})
