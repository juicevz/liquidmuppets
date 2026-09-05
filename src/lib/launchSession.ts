import type { Address, Hash } from 'viem'
import type { LaunchCheckpoint, LaunchInput, LaunchResult } from './protocol'
import type { StrategyTaskId } from '../types'

export const LAUNCH_SESSION_VERSION = 1 as const

export interface LaunchSession {
  version: typeof LAUNCH_SESSION_VERSION
  chainId: number
  factory: Address
  wallet: Address
  input: LaunchInput
  checkpoint: LaunchCheckpoint
  updatedAt: string
}

interface StoredLaunchSession extends Omit<LaunchSession, 'checkpoint'> {
  checkpoint: Omit<LaunchCheckpoint, 'agentId'> & { agentId?: string }
}

export function launchSessionStorageKey(chainId: number, factory: Address, wallet: Address): string {
  return `liquidmuppets-launch:${chainId}:${factory.toLowerCase()}:${wallet.toLowerCase()}`
}

export function createLaunchSession(
  chainId: number,
  factory: Address,
  wallet: Address,
  input: LaunchInput,
  checkpoint: LaunchCheckpoint = {},
): LaunchSession {
  return {
    version: LAUNCH_SESSION_VERSION,
    chainId,
    factory,
    wallet,
    input: { ...input },
    checkpoint: { ...checkpoint },
    updatedAt: new Date().toISOString(),
  }
}

export function withLaunchCheckpoint(session: LaunchSession, checkpoint: LaunchCheckpoint): LaunchSession {
  return { ...session, checkpoint: { ...checkpoint }, updatedAt: new Date().toISOString() }
}

export function serializeLaunchSession(session: LaunchSession): string {
  const stored: StoredLaunchSession = {
    ...session,
    checkpoint: {
      ...session.checkpoint,
      agentId: session.checkpoint.agentId?.toString(),
    },
  }
  return JSON.stringify(stored)
}

export function parseLaunchSession(
  raw: string,
  expected?: { chainId: number; factory: Address; wallet: Address },
): LaunchSession | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredLaunchSession>
    if (value.version !== LAUNCH_SESSION_VERSION
      || !Number.isSafeInteger(value.chainId)
      || !isAddress(value.factory)
      || !isAddress(value.wallet)
      || !isLaunchInput(value.input)
      || !isStoredCheckpoint(value.checkpoint)
      || typeof value.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(value.updatedAt))) return null
    if (expected && (
      value.chainId !== expected.chainId
      || value.factory.toLowerCase() !== expected.factory.toLowerCase()
      || value.wallet.toLowerCase() !== expected.wallet.toLowerCase()
    )) return null

    const checkpoint: LaunchCheckpoint = {
      ...value.checkpoint,
      agentId: value.checkpoint.agentId === undefined ? undefined : BigInt(value.checkpoint.agentId),
    }
    if (!checkpointIsConsistent(checkpoint)) return null
    return {
      version: LAUNCH_SESSION_VERSION,
      chainId: value.chainId as number,
      factory: value.factory,
      wallet: value.wallet,
      input: value.input,
      checkpoint,
      updatedAt: value.updatedAt,
    }
  } catch {
    return null
  }
}

export function readLaunchSession(storage: Storage, chainId: number, factory: Address, wallet: Address): LaunchSession | null {
  try {
    const raw = storage.getItem(launchSessionStorageKey(chainId, factory, wallet))
    return raw ? parseLaunchSession(raw, { chainId, factory, wallet }) : null
  } catch {
    return null
  }
}

export function saveLaunchSession(storage: Storage, session: LaunchSession): void {
  try {
    storage.setItem(launchSessionStorageKey(session.chainId, session.factory, session.wallet), serializeLaunchSession(session))
  } catch {
    // Launch recovery is a browser convenience. A blocked storage API must not block the wallet flow.
  }
}

export function clearLaunchSession(storage: Storage, chainId: number, factory: Address, wallet: Address): void {
  try {
    storage.removeItem(launchSessionStorageKey(chainId, factory, wallet))
  } catch {
    // Keep reset usable when the browser blocks local storage.
  }
}

export function launchHasStarted(checkpoint: LaunchCheckpoint): boolean {
  return Boolean(checkpoint.createTx || checkpoint.agentId !== undefined)
}

export function launchResultFromCheckpoint(checkpoint: LaunchCheckpoint): LaunchResult | null {
  if (!checkpoint.createConfirmed
    || checkpoint.agentId === undefined
    || !checkpoint.vault
    || !checkpoint.key
    || !checkpoint.createTx
    || !checkpoint.approveConfirmed
    || !checkpoint.approveTx
    || !checkpoint.listingConfirmed
    || !checkpoint.listingTx) return null
  return {
    agentId: checkpoint.agentId,
    vault: checkpoint.vault,
    key: checkpoint.key,
    createTx: checkpoint.createTx,
    approveTx: checkpoint.approveTx,
    listingTx: checkpoint.listingTx,
  }
}

function isLaunchInput(value: unknown): value is LaunchInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<LaunchInput>
  return Number.isInteger(input.petId)
    && Number(input.petId) >= 0
    && Number(input.petId) <= 6
    && isTaskId(input.taskId)
    && typeof input.name === 'string'
    && input.name.length >= 2
    && input.name.length <= 32
    && typeof input.keySymbol === 'string'
    && /^[A-Za-z0-9]{2,10}$/.test(input.keySymbol)
    && Number.isInteger(input.keySupply)
    && Number(input.keySupply) >= 10
    && Number(input.keySupply) <= 100_000
    && Number.isInteger(input.listingQuantity)
    && Number(input.listingQuantity) >= 1
    && Number(input.listingQuantity) <= Number(input.keySupply)
    && typeof input.floorPriceEth === 'string'
    && Number.isFinite(Number(input.floorPriceEth))
    && Number(input.floorPriceEth) > 0
}

function isStoredCheckpoint(value: unknown): value is StoredLaunchSession['checkpoint'] {
  if (!value || typeof value !== 'object') return false
  const checkpoint = value as StoredLaunchSession['checkpoint']
  return optionalHash(checkpoint.createTx)
    && optionalBoolean(checkpoint.createConfirmed)
    && (checkpoint.agentId === undefined || /^\d+$/.test(checkpoint.agentId))
    && optionalAddress(checkpoint.vault)
    && optionalAddress(checkpoint.key)
    && optionalHash(checkpoint.approveTx)
    && optionalBoolean(checkpoint.approveConfirmed)
    && optionalHash(checkpoint.listingTx)
    && optionalBoolean(checkpoint.listingConfirmed)
}

function checkpointIsConsistent(checkpoint: LaunchCheckpoint): boolean {
  if (checkpoint.createConfirmed && (!checkpoint.createTx || checkpoint.agentId === undefined || !checkpoint.vault || !checkpoint.key)) return false
  if (checkpoint.approveConfirmed && !checkpoint.approveTx) return false
  if (checkpoint.listingConfirmed && !checkpoint.listingTx) return false
  if ((checkpoint.approveTx || checkpoint.listingTx) && (!checkpoint.createConfirmed || !checkpoint.key)) return false
  if (checkpoint.listingTx && !checkpoint.approveConfirmed) return false
  return true
}

function isTaskId(value: unknown): value is StrategyTaskId {
  return value === 0 || value === 1 || value === 2
}

function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isHash(value: unknown): value is Hash {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function optionalAddress(value: unknown): value is Address | undefined {
  return value === undefined || isAddress(value)
}

function optionalHash(value: unknown): value is Hash | undefined {
  return value === undefined || isHash(value)
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}
