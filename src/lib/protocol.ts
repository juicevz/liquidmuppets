import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  toHex,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from 'viem'
import type { ProtocolConfig } from './api'
import type { StrategyTaskDefinition, StrategyTaskId, WalletProvider } from '../types'

const factoryAbi = [
  {
    type: 'function', name: 'agentCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'getAgent', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{
      type: 'tuple', components: [
        { name: 'creator', type: 'address' }, { name: 'vault', type: 'address' }, { name: 'key', type: 'address' },
        { name: 'petId', type: 'uint8' }, { name: 'taskId', type: 'uint8' }, { name: 'createdAt', type: 'uint40' },
        { name: 'baseFloorWei', type: 'uint128' }, { name: 'name', type: 'string' },
      ],
    }],
  },
  {
    type: 'function', name: 'createAgent', stateMutability: 'nonpayable', inputs: [
      { name: 'petId', type: 'uint8' }, { name: 'taskId', type: 'uint8' }, { name: 'name', type: 'string' },
      { name: 'keySymbol', type: 'string' }, { name: 'keySupply', type: 'uint256' }, { name: 'baseFloorWei', type: 'uint128' },
    ], outputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
  },
  {
    type: 'event', name: 'AgentCreated', inputs: [
      { name: 'agentId', type: 'uint256', indexed: true }, { name: 'creator', type: 'address', indexed: true },
      { name: 'vault', type: 'address', indexed: true }, { name: 'key', type: 'address', indexed: false },
      { name: 'petId', type: 'uint8', indexed: false }, { name: 'taskId', type: 'uint8', indexed: false },
      { name: 'baseFloorWei', type: 'uint256', indexed: false }, { name: 'name', type: 'string', indexed: false },
    ], anonymous: false,
  },
] as const

const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

const keyAbi = [
  ...erc20Abi,
  { type: 'function', name: 'totalBound', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'boundBalance', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bind', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
] as const

const vaultAbi = [
  ...erc20Abi,
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'adapter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'idleAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'deployedAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const marketAbi = [
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'nextListingId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nextOfferId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'listings', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { name: 'seller', type: 'address' }, { name: 'key', type: 'address' }, { name: 'quantity', type: 'uint128' },
    { name: 'unitPriceWei', type: 'uint128' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'offers', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { name: 'buyer', type: 'address' }, { name: 'key', type: 'address' }, { name: 'quantity', type: 'uint128' },
    { name: 'unitPriceWei', type: 'uint128' }, { name: 'escrowWei', type: 'uint256' }, { name: 'active', type: 'bool' },
  ] },
  { type: 'function', name: 'createListing', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint128' }, { type: 'uint128' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buy', stateMutability: 'payable', inputs: [{ type: 'uint256' }, { type: 'uint128' }], outputs: [] },
  { type: 'function', name: 'createOffer', stateMutability: 'payable', inputs: [{ type: 'address' }, { type: 'uint128' }, { type: 'uint128' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'acceptOffer', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint128' }], outputs: [] },
] as const

const policyAbi = [
  {
    type: 'function', name: 'executeAllocate', stateMutability: 'nonpayable', inputs: [
      { name: 'vault', type: 'address' }, { name: 'assets', type: 'uint256' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'executeRecallAll', stateMutability: 'nonpayable', inputs: [
      { name: 'vault', type: 'address' },
    ], outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function', name: 'executeRecenter', stateMutability: 'nonpayable', inputs: [
      { name: 'vault', type: 'address' },
    ], outputs: [{ name: 'recalled', type: 'uint256' }, { name: 'allocated', type: 'uint256' }],
  },
] as const

interface RawAgentRecord {
  creator: Address
  vault: Address
  key: Address
  petId: number
  taskId: number
  createdAt: number
  baseFloorWei: bigint
  name: string
}

interface ListingRecord {
  id: bigint
  seller: Address
  key: Address
  quantity: bigint
  unitPriceWei: bigint
  active: boolean
}

interface OfferRecord {
  id: bigint
  buyer: Address
  key: Address
  quantity: bigint
  unitPriceWei: bigint
  active: boolean
}

export interface ChainAgent {
  id: bigint
  name: string
  creator: Address
  petId: number
  taskId: StrategyTaskId
  createdAt: number
  baseFloorWei: bigint
  key: {
    address: Address
    symbol: string
    supply: bigint
    totalBound: bigint
    walletBalance: bigint
    walletBound: bigint
    floorWei: bigint | null
    floorListingId: bigint | null
    topBidWei: bigint | null
    topOfferId: bigint | null
    listed: bigint
  }
  vault: {
    address: Address
    symbol: string
    totalAssets: bigint
    totalSupply: bigint
    shareDecimals: number
    idleAssets: bigint
    deployedAssets: bigint
    walletShares: bigint
    walletAssetBalance: bigint
    assetAddress: Address
    assetSymbol: string
    assetDecimals: number
    adapterAddress: Address
  }
}

export interface ProtocolSnapshot {
  config: ProtocolConfig
  agents: ChainAgent[]
  feeBps: number
}

export function createProtocolClient(config: ProtocolConfig): PublicClient {
  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: 'Blockscout', url: config.explorerUrl } },
  })
  return createPublicClient({ chain, transport: http(config.rpcUrl) })
}

export async function loadProtocolSnapshot(config: ProtocolConfig, walletAddress?: string): Promise<ProtocolSnapshot> {
  if (!config.factory || !config.keyMarketplace) return { config, agents: [], feeBps: 300 }
  const client = createProtocolClient(config)
  const factory = config.factory
  const market = config.keyMarketplace
  const account = walletAddress as Address | undefined
  const [count, feeBps, listings, offers] = await Promise.all([
    client.readContract({ address: factory, abi: factoryAbi, functionName: 'agentCount' }),
    client.readContract({ address: market, abi: marketAbi, functionName: 'feeBps' }),
    loadListings(client, market),
    loadOffers(client, market),
  ])

  const records = await Promise.all(Array.from({ length: Number(count) }, (_, index) =>
    client.readContract({ address: factory, abi: factoryAbi, functionName: 'getAgent', args: [BigInt(index)] })
      .then((record) => record as unknown as RawAgentRecord),
  ))
  const agents = await Promise.all(records.map((record, index) => enrichAgent(client, record, BigInt(index), listings, offers, account)))
  return { config, agents, feeBps: Number(feeBps) }
}

async function enrichAgent(
  client: PublicClient,
  record: RawAgentRecord,
  id: bigint,
  listings: ListingRecord[],
  offers: OfferRecord[],
  account?: Address,
): Promise<ChainAgent> {
  const wallet = account ?? '0x0000000000000000000000000000000000000000'
  const [keySymbol, keySupply, totalBound, walletBalance, walletBound, vaultSymbol, vaultDecimals, totalAssets, totalSupply, idleAssets, deployedAssets, walletShares, assetAddress, adapterAddress] = await Promise.all([
    client.readContract({ address: record.key, abi: keyAbi, functionName: 'symbol' }),
    client.readContract({ address: record.key, abi: keyAbi, functionName: 'totalSupply' }),
    client.readContract({ address: record.key, abi: keyAbi, functionName: 'totalBound' }),
    client.readContract({ address: record.key, abi: keyAbi, functionName: 'balanceOf', args: [wallet] }),
    client.readContract({ address: record.key, abi: keyAbi, functionName: 'boundBalance', args: [wallet] }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'symbol' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'decimals' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'totalAssets' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'totalSupply' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'idleAssets' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'deployedAssets' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'balanceOf', args: [wallet] }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'asset' }),
    client.readContract({ address: record.vault, abi: vaultAbi, functionName: 'adapter' }),
  ])
  const asset = assetAddress as Address
  const [assetSymbol, assetDecimals, walletAssetBalance] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
  ])
  const keyListings = listings.filter((listing) => listing.active && listing.key.toLowerCase() === record.key.toLowerCase())
  const keyOffers = offers.filter((offer) => offer.active && offer.key.toLowerCase() === record.key.toLowerCase())
  const floor = keyListings.reduce<ListingRecord | null>((best, item) => !best || item.unitPriceWei < best.unitPriceWei ? item : best, null)
  const topBid = keyOffers.reduce<OfferRecord | null>((best, item) => !best || item.unitPriceWei > best.unitPriceWei ? item : best, null)
  return {
    id,
    name: record.name,
    creator: record.creator,
    petId: Number(record.petId),
    taskId: Number(record.taskId) as StrategyTaskId,
    createdAt: Number(record.createdAt),
    baseFloorWei: record.baseFloorWei,
    key: {
      address: record.key,
      symbol: keySymbol,
      supply: keySupply,
      totalBound,
      walletBalance,
      walletBound,
      floorWei: floor?.unitPriceWei ?? null,
      floorListingId: floor?.id ?? null,
      topBidWei: topBid?.unitPriceWei ?? null,
      topOfferId: topBid?.id ?? null,
      listed: keyListings.reduce((sum, listing) => sum + listing.quantity, 0n),
    },
    vault: {
      address: record.vault,
      symbol: vaultSymbol,
      totalAssets,
      totalSupply,
      shareDecimals: Number(vaultDecimals),
      idleAssets,
      deployedAssets,
      walletShares,
      walletAssetBalance,
      assetAddress: asset,
      assetSymbol,
      assetDecimals: Number(assetDecimals),
      adapterAddress: adapterAddress as Address,
    },
  }
}

async function loadListings(client: PublicClient, market: Address): Promise<ListingRecord[]> {
  const next = await client.readContract({ address: market, abi: marketAbi, functionName: 'nextListingId' })
  const ids = Array.from({ length: Math.max(0, Number(next) - 1) }, (_, index) => BigInt(index + 1))
  return Promise.all(ids.map(async (id) => {
    const row = await client.readContract({ address: market, abi: marketAbi, functionName: 'listings', args: [id] }) as unknown as readonly [Address, Address, bigint, bigint, boolean]
    return { id, seller: row[0], key: row[1], quantity: row[2], unitPriceWei: row[3], active: row[4] }
  }))
}

async function loadOffers(client: PublicClient, market: Address): Promise<OfferRecord[]> {
  const next = await client.readContract({ address: market, abi: marketAbi, functionName: 'nextOfferId' })
  const ids = Array.from({ length: Math.max(0, Number(next) - 1) }, (_, index) => BigInt(index + 1))
  return Promise.all(ids.map(async (id) => {
    const row = await client.readContract({ address: market, abi: marketAbi, functionName: 'offers', args: [id] }) as unknown as readonly [Address, Address, bigint, bigint, bigint, boolean]
    return { id, buyer: row[0], key: row[1], quantity: row[2], unitPriceWei: row[3], active: row[5] }
  }))
}

interface LaunchInput {
  petId: number
  taskId: StrategyTaskId
  name: string
  keySymbol: string
  keySupply: number
  listingQuantity: number
  floorPriceEth: string
}

export interface LaunchResult {
  agentId: bigint
  vault: Address
  key: Address
  createTx: Hash
  approveTx: Hash
  listingTx: Hash
}

export async function launchAgent(
  config: ProtocolConfig,
  provider: WalletProvider,
  account: Address,
  input: LaunchInput,
  onProgress?: (message: string) => void,
): Promise<LaunchResult> {
  if (!config.factory || !config.keyMarketplace) throw new Error('Mainnet contracts are not configured yet.')
  const client = createProtocolClient(config)
  const floorWei = parseEther(input.floorPriceEth)
  onProgress?.('Creating the vault and Agent Key…')
  const createReceipt = await sendAndWait(provider, client, account, config.factory, encodeFunctionData({
    abi: factoryAbi,
    functionName: 'createAgent',
    args: [input.petId, input.taskId, input.name, input.keySymbol.toUpperCase(), BigInt(input.keySupply), floorWei],
  }))
  const created = decodeAgentCreated(createReceipt, config.factory)
  onProgress?.('Approving the initial Key listing…')
  const approveReceipt = await sendAndWait(provider, client, account, created.key, encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [config.keyMarketplace, BigInt(input.listingQuantity)],
  }))
  onProgress?.('Opening the first ask at your base price…')
  const listingReceipt = await sendAndWait(provider, client, account, config.keyMarketplace, encodeFunctionData({
    abi: marketAbi,
    functionName: 'createListing',
    args: [created.key, BigInt(input.listingQuantity), floorWei],
  }))
  return {
    ...created,
    createTx: createReceipt.transactionHash,
    approveTx: approveReceipt.transactionHash,
    listingTx: listingReceipt.transactionHash,
  }
}

export async function depositToVault(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, amount: string): Promise<Hash[]> {
  const client = createProtocolClient(config)
  const assets = parseUnits(amount, agent.vault.assetDecimals)
  const approve = await sendAndWait(provider, client, account, agent.vault.assetAddress, encodeFunctionData({
    abi: erc20Abi, functionName: 'approve', args: [agent.vault.address, assets],
  }))
  const deposit = await sendAndWait(provider, client, account, agent.vault.address, encodeFunctionData({
    abi: vaultAbi, functionName: 'deposit', args: [assets, account],
  }))
  return [approve.transactionHash, deposit.transactionHash]
}

export async function redeemAll(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent): Promise<Hash> {
  if (agent.vault.walletShares === 0n) throw new Error('No vault shares to redeem.')
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, agent.vault.address, encodeFunctionData({
    abi: vaultAbi, functionName: 'redeem', args: [agent.vault.walletShares, account, account],
  }))).transactionHash
}

export async function runAgentCycle(
  config: ProtocolConfig,
  provider: WalletProvider,
  account: Address,
  agent: ChainAgent,
  targetAllocationBps: number,
): Promise<Hash> {
  if (!config.policyExecutor) throw new Error('Policy contract is not configured.')
  if (account.toLowerCase() !== agent.creator.toLowerCase()) throw new Error('Only this Muppet creator can run its strategy.')
  const target = agent.vault.totalAssets * BigInt(targetAllocationBps) / 10_000n
  if (agent.vault.deployedAssets >= target) throw new Error('The target allocation is already met.')
  const amount = [agent.vault.idleAssets, target - agent.vault.deployedAssets].reduce((a, b) => a < b ? a : b)
  if (amount === 0n) throw new Error('No idle assets are available.')
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, config.policyExecutor, encodeFunctionData({
    abi: policyAbi, functionName: 'executeAllocate', args: [agent.vault.address, amount],
  }))).transactionHash
}

export async function recallAgent(
  config: ProtocolConfig,
  provider: WalletProvider,
  account: Address,
  agent: ChainAgent,
): Promise<Hash> {
  if (!config.policyExecutor) throw new Error('Policy contract is not configured.')
  if (account.toLowerCase() !== agent.creator.toLowerCase()) throw new Error('Only this Muppet creator can recall its strategy.')
  if (agent.vault.deployedAssets === 0n) throw new Error('Nothing is deployed.')
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, config.policyExecutor, encodeFunctionData({
    abi: policyAbi, functionName: 'executeRecallAll', args: [agent.vault.address],
  }))).transactionHash
}

export async function recenterRange(
  config: ProtocolConfig,
  provider: WalletProvider,
  account: Address,
  agent: ChainAgent,
): Promise<Hash> {
  if (!config.policyExecutor) throw new Error('Policy contract is not configured.')
  if (account.toLowerCase() !== agent.creator.toLowerCase()) throw new Error('Only this Muppet creator can recenter its range.')
  if (agent.taskId !== 1) throw new Error('Only ETH range Muppets can recenter.')
  if (agent.vault.deployedAssets === 0n) throw new Error('No range is open.')
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, config.policyExecutor, encodeFunctionData({
    abi: policyAbi, functionName: 'executeRecenter', args: [agent.vault.address],
  }))).transactionHash
}

export async function buyFloorKeys(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, quantity: number, feeBps: number): Promise<Hash> {
  if (!config.keyMarketplace || agent.key.floorListingId === null || agent.key.floorWei === null) throw new Error('No active ask.')
  const subtotal = agent.key.floorWei * BigInt(quantity)
  const value = subtotal + subtotal * BigInt(feeBps) / 10_000n
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, config.keyMarketplace, encodeFunctionData({
    abi: marketAbi, functionName: 'buy', args: [agent.key.floorListingId, BigInt(quantity)],
  }), value)).transactionHash
}

export async function listKeys(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, quantity: number, priceEth: string): Promise<Hash[]> {
  if (!config.keyMarketplace) throw new Error('Marketplace is not configured.')
  const client = createProtocolClient(config)
  const price = parseEther(priceEth)
  const approve = await sendAndWait(provider, client, account, agent.key.address, encodeFunctionData({
    abi: erc20Abi, functionName: 'approve', args: [config.keyMarketplace, BigInt(quantity)],
  }))
  const listing = await sendAndWait(provider, client, account, config.keyMarketplace, encodeFunctionData({
    abi: marketAbi, functionName: 'createListing', args: [agent.key.address, BigInt(quantity), price],
  }))
  return [approve.transactionHash, listing.transactionHash]
}

export async function placeKeyOffer(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, quantity: number, priceEth: string, feeBps: number): Promise<Hash> {
  if (!config.keyMarketplace) throw new Error('Marketplace is not configured.')
  const price = parseEther(priceEth)
  const subtotal = price * BigInt(quantity)
  const value = subtotal + subtotal * BigInt(feeBps) / 10_000n
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, config.keyMarketplace, encodeFunctionData({
    abi: marketAbi, functionName: 'createOffer', args: [agent.key.address, BigInt(quantity), price],
  }), value)).transactionHash
}

export async function sellIntoTopBid(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, quantity: number): Promise<Hash[]> {
  if (!config.keyMarketplace || agent.key.topOfferId === null) throw new Error('No active bid.')
  const client = createProtocolClient(config)
  const approve = await sendAndWait(provider, client, account, agent.key.address, encodeFunctionData({
    abi: erc20Abi, functionName: 'approve', args: [config.keyMarketplace, BigInt(quantity)],
  }))
  const sale = await sendAndWait(provider, client, account, config.keyMarketplace, encodeFunctionData({
    abi: marketAbi, functionName: 'acceptOffer', args: [agent.key.topOfferId, BigInt(quantity)],
  }))
  return [approve.transactionHash, sale.transactionHash]
}

export async function bindKeys(config: ProtocolConfig, provider: WalletProvider, account: Address, agent: ChainAgent, quantity: number): Promise<Hash> {
  const client = createProtocolClient(config)
  return (await sendAndWait(provider, client, account, agent.key.address, encodeFunctionData({
    abi: keyAbi, functionName: 'bind', args: [BigInt(quantity)],
  }))).transactionHash
}

function decodeAgentCreated(receipt: TransactionReceipt, factory: Address): { agentId: bigint; vault: Address; key: Address } {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName !== 'AgentCreated') continue
      const args = decoded.args as unknown as { agentId: bigint; vault: Address; key: Address }
      return { agentId: args.agentId, vault: args.vault, key: args.key }
    } catch {
      continue
    }
  }
  throw new Error('The create transaction settled but the AgentCreated event was not found.')
}

async function sendAndWait(
  provider: WalletProvider,
  client: PublicClient,
  account: Address,
  to: Address,
  data: `0x${string}`,
  value?: bigint,
): Promise<TransactionReceipt> {
  const transaction: Record<string, string> = { from: account, to, data }
  if (value !== undefined) transaction.value = toHex(value)
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] }) as Hash
  return client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 })
}

export function formatAsset(value: bigint, decimals: number, digits = 4): string {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.')
  const compact = fraction.slice(0, digits).replace(/0+$/, '')
  return compact ? `${whole}.${compact}` : whole
}

export function formatEthValue(value: bigint | null, digits = 4): string {
  if (value === null) return 'unlisted'
  return `${Number(formatUnits(value, 18)).toFixed(digits)} ETH`
}

export function getInjectedProvider(): WalletProvider | undefined {
  return window.ethereum
}

export function taskForAgent(tasks: StrategyTaskDefinition[], agent: ChainAgent): StrategyTaskDefinition | undefined {
  return tasks.find((task) => task.id === agent.taskId)
}
