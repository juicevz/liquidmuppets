type ErrorRecord = Record<string, unknown>

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null
}

function readCode(value: unknown, depth = 0): unknown {
  if (!isRecord(value) || depth > 4) return undefined
  if ('code' in value) return value.code
  return readCode(value.cause, depth + 1) ?? readCode(value.error, depth + 1)
}

function readMessage(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (!isRecord(value) || depth > 4) return ''

  for (const key of ['shortMessage', 'details', 'message'] as const) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim()
  }

  return readMessage(value.cause, depth + 1)
    || readMessage(value.error, depth + 1)
    || readMessage(value.data, depth + 1)
}

export function actionErrorMessage(reason: unknown, fallback: string): string {
  const message = readMessage(reason)
  const code = readCode(reason)

  if (code === 4001 || /user (rejected|denied)|transaction (rejected|cancelled)/i.test(message)) {
    return 'Transaction cancelled in your wallet.'
  }
  if (/insufficient funds/i.test(message)) {
    return 'This wallet does not have enough funds for the transaction and network fee.'
  }
  if (!message) return fallback

  return message.split(/\n\n(?:Details|Version):/u, 1)[0].slice(0, 280)
}
