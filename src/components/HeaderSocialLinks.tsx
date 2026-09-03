import { useEffect, useId, useRef, useState } from 'react'

const xAccounts = [
  {
    handle: '@liquidmuppets',
    description: 'official',
    href: 'https://x.com/liquidmuppets',
  },
  {
    handle: '@AMBF',
    description: 'juice, founder',
    href: 'https://x.com/AMBF',
  },
] as const

const xIcon = (
  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
)

const githubIcon = (
  <path d="M12 .5C5.63.5.5 5.76.5 12.27c0 5.21 3.3 9.63 7.87 11.19.58.1.79-.26.79-.57v-2.23c-3.2.71-3.88-1.58-3.88-1.58-.52-1.37-1.28-1.73-1.28-1.73-1.05-.74.08-.72.08-.72 1.16.08 1.77 1.21 1.77 1.21 1.03 1.8 2.7 1.28 3.36.98.1-.76.4-1.28.73-1.57-2.56-.3-5.25-1.31-5.25-5.83 0-1.29.45-2.34 1.19-3.17-.12-.3-.52-1.5.11-3.13 0 0 .97-.32 3.16 1.21A10.77 10.77 0 0 1 12 6.97c.98 0 1.95.14 2.87.39 2.2-1.53 3.16-1.21 3.16-1.21.63 1.63.23 2.83.11 3.13.74.83 1.19 1.88 1.19 3.17 0 4.53-2.7 5.53-5.27 5.82.41.37.78 1.08.78 2.18v2.44c0 .32.21.68.79.57a11.78 11.78 0 0 0 7.87-11.19C23.5 5.76 18.37.5 12 .5Z" />
)

export function HeaderSocialLinks() {
  const [xMenuOpen, setXMenuOpen] = useState(false)
  const menuId = useId()
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusMenuOnOpenRef = useRef(false)

  useEffect(() => {
    if (!xMenuOpen) return

    if (focusMenuOnOpenRef.current) {
      menuRef.current?.querySelector<HTMLAnchorElement>('a')?.focus()
      focusMenuOnOpenRef.current = false
    }

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setXMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setXMenuOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [xMenuOpen])

  const focusFirstAccount = () => {
    const firstAccount = menuRef.current?.querySelector<HTMLAnchorElement>('a')
    if (firstAccount) {
      firstAccount.focus()
      return
    }
    focusMenuOnOpenRef.current = true
    setXMenuOpen(true)
  }

  const moveMenuFocus = (direction: 1 | -1) => {
    const links = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
    if (!links.length) return
    const activeIndex = links.findIndex((link) => link === document.activeElement)
    const nextIndex = activeIndex < 0
      ? direction === 1 ? 0 : links.length - 1
      : (activeIndex + direction + links.length) % links.length
    links[nextIndex]?.focus()
  }

  return (
    <div className="header-social-links" role="group" aria-label="Social links">
      <div className="x-account-picker" ref={pickerRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`header-social-link header-social-x-trigger${xMenuOpen ? ' is-open' : ''}`}
          aria-label="Choose an X account"
          aria-haspopup="menu"
          aria-expanded={xMenuOpen}
          aria-controls={xMenuOpen ? menuId : undefined}
          title="X accounts"
          onClick={() => setXMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            focusFirstAccount()
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {xIcon}
          </svg>
        </button>

        {xMenuOpen && (
          <div
            ref={menuRef}
            id={menuId}
            className="header-social-menu"
            role="menu"
            aria-label="X accounts"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              moveMenuFocus(event.key === 'ArrowDown' ? 1 : -1)
            }}
          >
            <span className="header-social-menu-label">choose an account</span>
            {xAccounts.map((account) => (
              <a
                key={account.href}
                className="header-social-account"
                href={account.href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setXMenuOpen(false)}
              >
                <span>
                  <strong>{account.handle}</strong>
                  <small>{account.description}</small>
                </span>
                <span className="header-social-account-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <a
        className="header-social-link"
        href="https://github.com/juicevz/liquidmuppets"
        target="_blank"
        rel="noreferrer"
        aria-label="LiquidMuppets on GitHub"
        title="LiquidMuppets on GitHub"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {githubIcon}
        </svg>
      </a>
    </div>
  )
}
