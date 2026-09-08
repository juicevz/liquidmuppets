import {
  BaseError, createPublicClient, custom, decodeFunctionData, encodeFunctionData, isAddress, parseUnits, toHex,
  type Address, type Hash, type TransactionReceipt,
} from 'viem'
import type { WalletProvider } from '../types'
import type { ProtocolConfig } from './api'
import { createProtocolClient, type AgentBondTerm } from './protocol'

export const REINVESTMENT_UNIT = 15_000n * 10n ** 18n
export const REINVESTMENT_QUOTE_SECONDS = 120
export const REINVESTMENT_MAX_SLIPPAGE_BPS = 300
const UINT256_MAX = (1n << 256n) - 1n
const UINT128_MAX = (1n << 128n) - 1n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const reinvestmentAbi = [
  { type: 'function', name: 'claimBuyAndBond', stateMutability: 'nonpayable', inputs: [
    { name: 'positionId', type: 'uint256' }, { name: 'wethToSpend', type: 'uint256' },
    { name: 'key', type: 'address' }, { name: 'units', type: 'uint256' }, { name: 'term', type: 'uint8' },
    { name: 'minimumOutput', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ], outputs: [
    { name: 'newPositionId', type: 'uint256' }, { name: 'muppetsBought', type: 'uint256' },
    { name: 'globalClaimed', type: 'uint256' }, { name: 'keyClaimed', type: 'uint256' },
  ] },
  { type: 'function', name: 'REWARD_BUY_EXECUTOR', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'REINVESTMENT_VERSION', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'MUPPETS', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'WETH', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'UNIT_SIZE', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'pendingPositionRewards', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'availableBoundKeys', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'error', name: 'InsufficientBoughtMuppets', inputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'RewardSpendExceeded', inputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'MissingBoundKeys', inputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'NotPositionOwner', inputs: [] },
  { type: 'error', name: 'DeadlineInvalid', inputs: [] },
] as const

export interface ReinvestmentMetadata {
  available: boolean
  executor: Address | null
}

export interface ReinvestmentInput {
  positionId: bigint
  key: Address
  units: bigint
  term: AgentBondTerm
  wethToSpend: bigint
  slippageBps?: number
}

export interface ReinvestmentQuote {
  readonly chainId: number
  readonly account: Address
  readonly bond: Address
  readonly executor: Address
  readonly muppets: Address
  readonly weth: Address
  readonly key: Address
  readonly positionId: bigint
  readonly units: bigint
  readonly term: AgentBondTerm
  readonly wethToSpend: bigint
  readonly slippageBps: number
  readonly bondAmount: bigint
  readonly quotedOutput: bigint
  readonly minimumOutput: bigint
  readonly globalClaimed: bigint
  readonly keyClaimed: bigint
  readonly remainderWeth: bigint
  readonly createdAt: number
  readonly expiresAt: number
  readonly deadline: number
  readonly estimatedGas: bigint
  readonly gasLimit: bigint
  readonly gasPrice: bigint
  readonly nativeGasCost: bigint
}

interface ReinvestmentRequest {
  config: ProtocolConfig
  provider: WalletProvider
  account: Address
  metadata: ReinvestmentMetadata
  input: ReinvestmentInput
}

interface ExecuteReinvestmentRequest extends ReinvestmentRequest {
  quote: ReinvestmentQuote
  onSubmitted?: (hash: Hash) => void
}

// Keep a submitted-but-unconfirmed transaction guarded for this page session.
// Never retry a money-moving action automatically after a receipt timeout.
const pendingTransactions = new Map<string, Hash | 'preparing'>()

export function parseReinvestmentWeth(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error('Enter a WETH amount with at most 18 decimal places.')
  }
  const amount = parseUnits(value, 18)
  requirePositiveBigint(amount, UINT256_MAX, 'WETH amount')
  return amount
}

export function parseReinvestmentUnits(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('Enter a whole number of bond units.')
  const units = BigInt(value)
  requirePositiveBigint(units, UINT128_MAX, 'Bond units')
  return units
}

function requirePositiveBigint(value: bigint, maximum: bigint, label: string): void {
  if (typeof value !== 'bigint' || value <= 0n || value > maximum) {
    throw new Error(`${label} must be a positive whole number within the supported range.`)
  }
}

function inputSlippage(input: ReinvestmentInput): number {
  const slippage = input.slippageBps ?? 100
  if (!Number.isInteger(slippage) || slippage < 0 || slippage > REINVESTMENT_MAX_SLIPPAGE_BPS) {
    throw new Error('Slippage must be between 0% and 3%.')
  }
  return slippage
}

function validateInput(input: ReinvestmentInput): void {
  requirePositiveBigint(input.positionId, UINT256_MAX, 'Position')
  requirePositiveBigint(input.units, UINT128_MAX, 'Bond units')
  requirePositiveBigint(input.wethToSpend, UINT256_MAX, 'WETH amount')
  if (!validAddress(input.key)) throw new Error('Choose a valid Agent Key.')
  if (input.term !== 0 && input.term !== 1 && input.term !== 2) throw new Error('Choose a supported bond term.')
  inputSlippage(input)
}

function validAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value) && value.toLowerCase() !== ZERO_ADDRESS
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function configured(request: ReinvestmentRequest): { bond: Address; muppets: Address; executor: Address } {
  const { config, metadata, account, input } = request
  if (metadata.available !== true || !validAddress(metadata.executor)) {
    throw new Error('Buy and bond is not active. You can claim WETH when ordinary claims are available.')
  }
  if (!validAddress(config.agentBond) || !validAddress(config.accessGate.tokenAddress) || !validAddress(config.WETH)) {
    throw new Error('The verified buy-and-bond contracts are not configured.')
  }
  if (!validAddress(account) || !Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    throw new Error('Connect a supported wallet and network.')
  }
  validateInput(input)
  return { bond: config.agentBond, muppets: config.accessGate.tokenAddress, executor: metadata.executor }
}

function rpcQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`The wallet returned an invalid ${label}.`)
  return BigInt(value)
}

async function assertWallet(request: ReinvestmentRequest): Promise<void> {
  const [accounts, chain] = await Promise.all([
    request.provider.request({ method: 'eth_accounts' }),
    request.provider.request({ method: 'eth_chainId' }),
  ])
  if (!Array.isArray(accounts) || !validAddress(accounts[0]) || !sameAddress(accounts[0], request.account)) {
    throw new Error('The connected wallet changed. Connect the quoted wallet and get a new quote.')
  }
  if (rpcQuantity(chain, 'chain ID') !== BigInt(request.config.chainId)) {
    throw new Error('The wallet network changed. Switch to the configured chain and get a new quote.')
  }
}

async function preflight(request: ReinvestmentRequest, client: ReturnType<typeof createProtocolClient>): Promise<void> {
  const { bond, muppets, executor } = configured(request)
  const [chain, version, actualExecutor, actualMuppets, actualWeth, unit, paused, pending, availableKeys, executorMuppets] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'REINVESTMENT_VERSION' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'REWARD_BUY_EXECUTOR' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'MUPPETS' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'WETH' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'UNIT_SIZE' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'paused' }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'pendingPositionRewards', args: [request.input.positionId] }),
    client.readContract({ address: bond, abi: reinvestmentAbi, functionName: 'availableBoundKeys', args: [request.account, request.input.key] }),
    client.readContract({ address: executor, abi: reinvestmentAbi, functionName: 'MUPPETS' }),
  ])
  if (chain !== request.config.chainId || version !== 1n || !sameAddress(actualExecutor, executor)
    || !sameAddress(actualMuppets, muppets) || !sameAddress(actualWeth, request.config.WETH)
    || !sameAddress(executorMuppets, muppets) || unit !== REINVESTMENT_UNIT || paused) {
    throw new Error('The live buy-and-bond configuration does not match the verified route. Refresh before continuing.')
  }
  if (pending[0] + pending[1] < request.input.wethToSpend) {
    throw new Error('This amount exceeds this position’s claimable WETH. Refresh or lower the amount.')
  }
  if (availableKeys < request.input.units) {
    throw new Error('There are not enough unused permanently bound Agent Keys for these new bond units.')
  }
}

function contractCall(request: ReinvestmentRequest, minimumOutput: bigint, deadline: number) {
  const { bond } = configured(request)
  const { input } = request
  return {
    address: bond, abi: reinvestmentAbi, functionName: 'claimBuyAndBond' as const, account: request.account,
    args: [input.positionId, input.wethToSpend, input.key, input.units, input.term, minimumOutput, BigInt(deadline)] as const,
  }
}

function transaction(request: ReinvestmentRequest, minimumOutput: bigint, deadline: number) {
  const call = contractCall(request, minimumOutput, deadline)
  return { from: request.account, to: call.address, data: encodeFunctionData(call), value: '0x0' }
}

function minimumOutputFor(output: bigint, units: bigint, slippageBps: number): bigint {
  const required = units * REINVESTMENT_UNIT
  if (output < required) throw new Error('These rewards cannot buy enough MUPPETS for the selected bond units. Claim WETH or wait for more rewards.')
  const slippageMinimum = output * BigInt(10_000 - slippageBps) / 10_000n
  return slippageMinimum > required ? slippageMinimum : required
}

async function gasQuote(request: ReinvestmentRequest, minimumOutput: bigint, deadline: number) {
  const [gas, price, balance] = await Promise.all([
    request.provider.request({ method: 'eth_estimateGas', params: [transaction(request, minimumOutput, deadline)] }),
    request.provider.request({ method: 'eth_gasPrice' }),
    request.provider.request({ method: 'eth_getBalance', params: [request.account, 'pending'] }),
  ])
  const estimatedGas = rpcQuantity(gas, 'gas estimate')
  const gasPrice = rpcQuantity(price, 'gas price')
  if (estimatedGas === 0n || gasPrice === 0n) throw new Error('A current network-fee estimate is unavailable. Try quoting again.')
  const gasLimit = (estimatedGas * 120n + 99n) / 100n
  const nativeGasCost = gasLimit * gasPrice
  if (rpcQuantity(balance, 'ETH balance') < nativeGasCost) {
    throw new Error('Your wallet needs more native ETH for gas. WETH rewards cannot pay this transaction fee.')
  }
  return { estimatedGas, gasLimit, gasPrice, nativeGasCost }
}

function simulationError(error: unknown): Error {
  const cause = error instanceof BaseError ? error.walk() : error
  const data = typeof cause === 'object' && cause !== null && 'data' in cause ? cause.data : null
  const name = typeof data === 'object' && data !== null && 'errorName' in data ? data.errorName : null
  if (name === 'InsufficientBoughtMuppets') return new Error('These rewards cannot buy enough MUPPETS for the selected bond units. Claim WETH or wait for more rewards.', { cause: error })
  if (name === 'RewardSpendExceeded') return new Error('Claimable WETH changed. Refresh the position and quote again.', { cause: error })
  if (name === 'MissingBoundKeys') return new Error('Unused bound Agent Key capacity changed. Refresh and quote again.', { cause: error })
  if (name === 'NotPositionOwner') return new Error('This wallet does not own the reward position.', { cause: error })
  return new Error('The live buy-and-bond simulation failed. Rewards may be too small, the price may have moved, or the route may be unavailable. Nothing was sent. Refresh or claim WETH instead.', { cause: error })
}

export async function quoteReinvestment(request: ReinvestmentRequest): Promise<ReinvestmentQuote> {
  const { bond, muppets, executor } = configured(request)
  await assertWallet(request)
  const client = createProtocolClient(request.config, { fresh: true })
  await preflight(request, client)
  const createdAt = Math.floor(Date.now() / 1000)
  const expiresAt = createdAt + REINVESTMENT_QUOTE_SECONDS
  const deadline = expiresAt
  let result: readonly [bigint, bigint, bigint, bigint]
  try {
    result = (await client.simulateContract(contractCall(request, request.input.units * REINVESTMENT_UNIT, deadline))).result
  } catch (error) { throw simulationError(error) }
  const [, quotedOutput, globalClaimed, keyClaimed] = result
  if (globalClaimed + keyClaimed < request.input.wethToSpend) throw new Error('The simulated claim cannot cover this WETH amount.')
  const slippageBps = inputSlippage(request.input)
  const minimumOutput = minimumOutputFor(quotedOutput, request.input.units, slippageBps)
  const gas = await gasQuote(request, minimumOutput, deadline)
  await assertWallet(request)
  if (Math.floor(Date.now() / 1000) >= expiresAt) throw new Error('The quote expired while loading. Get a new quote.')
  return Object.freeze({
    chainId: request.config.chainId, account: request.account, bond, executor, muppets, weth: request.config.WETH,
    ...request.input, slippageBps, bondAmount: request.input.units * REINVESTMENT_UNIT,
    quotedOutput, minimumOutput, globalClaimed, keyClaimed,
    remainderWeth: globalClaimed + keyClaimed - request.input.wethToSpend,
    createdAt, expiresAt, deadline, ...gas,
  })
}

export function validateReinvestmentQuote(request: ReinvestmentRequest, quote: ReinvestmentQuote): void {
  const { bond, muppets, executor } = configured(request)
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(quote.createdAt) || !Number.isSafeInteger(quote.expiresAt) || !Number.isSafeInteger(quote.deadline)
    || quote.createdAt > now || now >= quote.expiresAt || now >= quote.deadline
    || quote.expiresAt !== quote.createdAt + REINVESTMENT_QUOTE_SECONDS || quote.deadline !== quote.expiresAt
    || quote.deadline > now + 300) throw new Error('This quote expired or has an invalid deadline. Get a new quote.')
  const { input } = request
  if (quote.chainId !== request.config.chainId || !sameAddress(quote.account, request.account)
    || !sameAddress(quote.bond, bond) || !sameAddress(quote.executor, executor) || !sameAddress(quote.muppets, muppets)
    || !sameAddress(quote.weth, request.config.WETH) || !sameAddress(quote.key, input.key)
    || quote.positionId !== input.positionId || quote.units !== input.units || quote.term !== input.term
    || quote.wethToSpend !== input.wethToSpend || quote.slippageBps !== inputSlippage(input)) {
    throw new Error('The wallet, network, position, or buy-and-bond inputs changed. Get a new quote.')
  }
  if (quote.bondAmount !== input.units * REINVESTMENT_UNIT
    || quote.minimumOutput !== minimumOutputFor(quote.quotedOutput, input.units, quote.slippageBps)
    || quote.nativeGasCost !== quote.gasLimit * quote.gasPrice || quote.gasPrice <= 0n
    || quote.estimatedGas <= 0n || quote.gasLimit !== (quote.estimatedGas * 120n + 99n) / 100n) {
    throw new Error('The quote no longer matches its protected output and gas estimate. Get a new quote.')
  }
}

export async function executeReinvestment(request: ExecuteReinvestmentRequest): Promise<TransactionReceipt> {
  validateReinvestmentQuote(request, request.quote)
  const guardKey = `${request.config.chainId}:${request.account.toLowerCase()}`
  if (pendingTransactions.has(guardKey)) throw new Error('A buy-and-bond transaction is already pending. Check it before submitting another.')
  pendingTransactions.set(guardKey, 'preparing')
  let submitted: Hash | undefined
  let settled = false
  try {
    await assertWallet(request)
    const client = createProtocolClient(request.config, { fresh: true })
    await preflight(request, client)
    try { await client.simulateContract(contractCall(request, request.quote.minimumOutput, request.quote.deadline)) }
    catch (error) { throw simulationError(error) }
    const gas = await gasQuote(request, request.quote.minimumOutput, request.quote.deadline)
    if (gas.nativeGasCost > request.quote.nativeGasCost) throw new Error('The network-fee estimate increased. Get a new quote to review it.')
    await assertWallet(request)
    validateReinvestmentQuote(request, request.quote)
    let hash: unknown
    try {
      hash = await request.provider.request({ method: 'eth_sendTransaction', params: [{
        ...transaction(request, request.quote.minimumOutput, request.quote.deadline),
        gas: toHex(gas.gasLimit), gasPrice: toHex(gas.gasPrice),
      }] })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) throw error
      submitted = '0x' as Hash
      throw new Error('The wallet could not confirm whether this transaction was submitted. Check its activity before retrying.', { cause: error })
    }
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) {
      // The provider may have submitted despite an invalid response. Do not silently retry.
      submitted = '0x' as Hash
      throw new Error('The wallet returned no valid transaction hash. Check its activity before trying again.')
    }
    submitted = hash as Hash
    pendingTransactions.set(guardKey, submitted)
    // A UI callback must not interrupt confirmation or turn a submitted action into a retry.
    try { request.onSubmitted?.(submitted) } catch { /* confirmation still runs */ }
    const receiptClient = createPublicClient({ chain: client.chain, transport: custom(request.provider, { retryCount: 1 }) })
    let receipt: TransactionReceipt
    try { receipt = await receiptClient.waitForTransactionReceipt({ hash: submitted, confirmations: 1, timeout: 60_000 }) }
    catch (error) {
      throw new Error(`Transaction ${submitted} was submitted but confirmation is unavailable. Check your wallet or explorer before retrying.`, { cause: error })
    }
    settled = true
    if (receipt.status !== 'success') throw new Error('The buy-and-bond transaction reverted. Rewards and existing bonds were not changed by this transaction; gas was spent.')
    return receipt
  } finally {
    if (!submitted || settled) pendingTransactions.delete(guardKey)
  }
}

export async function reconcileReinvestment(request: {
  config: ProtocolConfig
  account: Address
  hash: Hash
  positionId?: bigint
}): Promise<TransactionReceipt> {
  const { config, account, hash, positionId } = request
  if (!validAddress(config.agentBond) || !validAddress(account) || !/^0x[0-9a-f]{64}$/i.test(hash)) {
    throw new Error('The pending transaction identity is invalid.')
  }
  const client = createProtocolClient(config, { fresh: true })
  const [chain, receipt, tx] = await Promise.all([
    client.getChainId(), client.getTransactionReceipt({ hash }), client.getTransaction({ hash }),
  ])
  if (chain !== config.chainId || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
    || !sameAddress(tx.from, account) || !tx.to || !sameAddress(tx.to, config.agentBond)
    || (receipt.status !== 'success' && receipt.status !== 'reverted')) {
    throw new Error('This receipt does not match the pending wallet and bond transaction.')
  }
  const decoded = decodeFunctionData({ abi: reinvestmentAbi, data: tx.input })
  if (decoded.functionName !== 'claimBuyAndBond' || (positionId !== undefined && decoded.args[0] !== positionId)) {
    throw new Error('This receipt is not the expected buy-and-bond position transaction.')
  }
  const guardKey = `${config.chainId}:${account.toLowerCase()}`
  const guarded = pendingTransactions.get(guardKey)
  if (guarded !== 'preparing' && guarded?.toLowerCase() === hash.toLowerCase()) pendingTransactions.delete(guardKey)
  return receipt
}
