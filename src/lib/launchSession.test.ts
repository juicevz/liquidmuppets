import { describe, expect, it } from 'vitest'
import type { Address, Hash } from 'viem'
import {
  createLaunchSession,
  launchHasStarted,
  launchResultFromCheckpoint,
  parseLaunchSession,
  serializeLaunchSession,
  withLaunchCheckpoint,
} from './launchSession'

const factory = '0x1111111111111111111111111111111111111111' as Address
const wallet = '0x2222222222222222222222222222222222222222' as Address
const vault = '0x3333333333333333333333333333333333333333' as Address
const key = '0x4444444444444444444444444444444444444444' as Address
const createTx = `0x${'a'.repeat(64)}` as Hash
const approveTx = `0x${'b'.repeat(64)}` as Hash
const listingTx = `0x${'c'.repeat(64)}` as Hash
const input = {
  petId: 2,
  taskId: 1 as const,
  name: 'range fox',
  keySymbol: 'RFOX',
  keySupply: 100,
  listingQuantity: 20,
  floorPriceEth: '0.01',
}

describe('launch session recovery', () => {
  it('round trips bigint checkpoints and recovers a complete result', () => {
    const session = withLaunchCheckpoint(createLaunchSession(4663, factory, wallet, input), {
      createTx,
      createConfirmed: true,
      agentId: 17n,
      vault,
      key,
      approveTx,
      approveConfirmed: true,
      listingTx,
      listingConfirmed: true,
    })
    const restored = parseLaunchSession(serializeLaunchSession(session), { chainId: 4663, factory, wallet })

    expect(restored?.checkpoint.agentId).toBe(17n)
    expect(launchResultFromCheckpoint(restored!.checkpoint)).toEqual({ agentId: 17n, vault, key, createTx, approveTx, listingTx })
  })

  it('keeps a submitted transaction resumable before confirmation', () => {
    const session = withLaunchCheckpoint(createLaunchSession(4663, factory, wallet, input), { createTx, createConfirmed: false })
    const restored = parseLaunchSession(serializeLaunchSession(session))

    expect(launchHasStarted(restored!.checkpoint)).toBe(true)
    expect(launchResultFromCheckpoint(restored!.checkpoint)).toBeNull()
  })

  it('rejects corrupted data and the wrong wallet identity', () => {
    const session = createLaunchSession(4663, factory, wallet, input)
    const serialized = serializeLaunchSession(session)

    expect(parseLaunchSession('{broken')).toBeNull()
    expect(parseLaunchSession(serialized, {
      chainId: 4663,
      factory,
      wallet: '0x9999999999999999999999999999999999999999',
    })).toBeNull()
  })
})
