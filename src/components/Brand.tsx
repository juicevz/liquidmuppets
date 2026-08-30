import liquidMuppetsMark from '../assets/liquidmuppets-mark-linocut.png'

interface BrandProps {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <span className="brand" aria-label="LIQUIDMUPPETS">
      <span className="brand-mark" aria-hidden="true">
        <img src={liquidMuppetsMark} alt="" />
      </span>
      {!compact && <span className="brand-word">LIQUIDMUPPETS</span>}
    </span>
  )
}
