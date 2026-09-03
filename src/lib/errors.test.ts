import { describe, expect, it } from 'vitest'
import { actionErrorMessage } from './errors'

describe('actionErrorMessage', () => {
  it('understands plain EIP-1193 rejection objects', () => {
    expect(actionErrorMessage({ code: 4001, message: 'User rejected the request.' }, 'Launch failed.'))
      .toBe('Transaction cancelled in your wallet.')
  })

  it('prefers the concise viem message', () => {
    expect(actionErrorMessage({
      shortMessage: 'Execution reverted.',
      message: 'Execution reverted.\n\nDetails: a very long provider response',
    }, 'Launch failed.')).toBe('Execution reverted.')
  })

  it('walks nested provider errors and keeps a safe fallback', () => {
    expect(actionErrorMessage({ error: { data: { message: 'RPC unavailable' } } }, 'Launch failed.'))
      .toBe('RPC unavailable')
    expect(actionErrorMessage(null, 'Launch failed.')).toBe('Launch failed.')
  })
})
