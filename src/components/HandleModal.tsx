import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

interface HandleModalProps {
  onSave: (handle: string) => Promise<void>
  onSkip: () => void
}

export function HandleModal({ onSave, onSkip }: HandleModalProps) {
  const [handle, setHandle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 420)
    return () => window.clearTimeout(timeout)
  }, [])

  const submit = async () => {
    const clean = handle.trim().toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
      setError('Use 3 to 20 letters, numbers or underscores.')
      return
    }
    setBusy(true)
    try {
      await onSave(`@${clean}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify this handle.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="handle-backdrop" role="presentation">
      <section className="handle-modal" role="dialog" aria-modal="true" aria-labelledby="handle-title">
        <button type="button" className="icon-button handle-close" onClick={onSkip} aria-label="Close handle setup">
          <Icon name="close" />
        </button>
        <span className="eyebrow">FIRST THING</span>
        <h2 id="handle-title">Take your handle.</h2>
        <p>This is the public name shown beneath every agent you deploy.</p>
        <label htmlFor="handle">public @</label>
        <div className="handle-field">
          <span>@</span>
          <input
            ref={inputRef}
            id="handle"
            value={handle.replace(/^@/, '')}
            onChange={(event) => {
              setHandle(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
            placeholder="yourhandle"
            autoComplete="off"
          />
        </div>
        <div className="handle-help" aria-live="polite">{error || 'Your wallet signs this public handle. No gas and no transaction.'}</div>
        <button type="button" className="button button-dark handle-submit" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Check wallet' : 'Sign handle'}
          <Icon name="arrow" />
        </button>
      </section>
    </div>
  )
}
