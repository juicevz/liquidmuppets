import type { ReactNode, SVGProps } from 'react'

type IconName =
  | 'alert'
  | 'arrow'
  | 'bars'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'close'
  | 'key'
  | 'layers'
  | 'lock'
  | 'pause'
  | 'receipt'
  | 'search'
  | 'shield'
  | 'spark'
  | 'wallet'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

const paths: Record<IconName, ReactNode> = {
  alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  bars: <path d="M5 7h14M5 12h14M5 17h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  key: <><circle cx="8" cy="12" r="3" /><path d="M11 12h8m-2 0v3m-3-3v2" /></>,
  layers: <path d="m12 3 8 4-8 4-8-4 8-4Zm-8 9 8 4 8-4M4 17l8 4 8-4" />,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  pause: <path d="M9 7v10M15 7v10" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
  shield: <path d="M12 3 5 6v5c0 4.6 2.8 7.9 7 10 4.2-2.1 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" />,
  spark: <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" />,
  wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2V18H6a2 2 0 0 1-2-2V6.5Z" /><path d="M4 7V5a2 2 0 0 1 2-2h10v3.5m0 4.5h4v4h-4a2 2 0 0 1 0-4Z" /></>,
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
