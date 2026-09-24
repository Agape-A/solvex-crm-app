// Set minimale di icone SVG in stile "line icon" per la navigazione e i
// bottoni principali. Niente dipendenze esterne (nessuna icon library
// installabile in questo ambiente): ogni icona è un piccolo componente che
// eredita colore/dimensione dal testo circostante (stroke="currentColor").

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconDashboard(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.6" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.6" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.6" />
    </svg>
  )
}

export function IconPipeline(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 5h17l-6.2 7.8v5.7l-4.6 2v-7.7z" />
    </svg>
  )
}

export function IconClients(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <circle cx="17" cy="8.5" r="2.5" />
      <path d="M15.7 14.3c2.4.4 4.3 2.3 4.3 5.2" />
    </svg>
  )
}

export function IconRequests(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 13.5 7 4.5h10l3.5 9" />
      <path d="M3.5 13.5v5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5h-5.2a2.8 2.8 0 0 1-5.6 0z" />
    </svg>
  )
}

export function IconCalendar(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13.2h2M11 13.2h2M14.5 13.2h2M7.5 16.7h2M11 16.7h2" />
    </svg>
  )
}

export function IconMarketing(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 10.5v3.5h3.2L12 17.8V6.7L6.7 10.5z" />
      <path d="M15.3 4.3a10 10 0 0 1 0 15.4M18.2 7.4a6 6 0 0 1 0 9.2" />
    </svg>
  )
}

export function IconReport(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20.5V3.5M4 20.5h16.5" />
      <rect x="7" y="12.5" width="3" height="5.2" rx=".6" />
      <rect x="12" y="8.5" width="3" height="9.2" rx=".6" />
      <rect x="17" y="5.5" width="3" height="12.2" rx=".6" />
    </svg>
  )
}

export function IconChat(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H4A1.5 1.5 0 0 1 2.5 15.5V7A1.5 1.5 0 0 1 4 5.5z" />
      <path d="M17.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4" opacity="0" />
    </svg>
  )
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9" />
      <path d="M16 16.5 21 12l-5-4.5M21 12H9" />
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.35-4.35" />
    </svg>
  )
}

export function IconFlask(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 3.5h5M10 4v6.3L4.9 18a2 2 0 0 0 1.7 3h10.8a2 2 0 0 0 1.7-3L14 10.3V4" />
      <path d="M7.3 15.5h9.4" />
    </svg>
  )
}

export function IconChevronsLeft(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 5.5 7.5 12l6.5 6.5" />
      <path d="M19 5.5 12.5 12l6.5 6.5" />
    </svg>
  )
}

export function IconDevelopment(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8z" />
      <path d="M3.5 12.5 12 17l8.5-4.5" />
      <path d="M3.5 16.5 12 21l8.5-4.5" />
    </svg>
  )
}

export function IconResearch(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 20.5h8" />
      <path d="M12 20.5v-4" />
      <path d="M7 16.5h8a3 3 0 0 0 0-6H9.5" />
      <circle cx="9.5" cy="9" r="2.3" />
      <path d="M8 6.8 6.2 5" />
      <path d="M11.5 6 13 4.3" />
    </svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M15.5 4.3a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17 14.2c2.2.6 3.5 2.5 3.5 5.3" />
    </svg>
  )
}

export function IconSuppliers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 8.5 12 4l8.5 4.5-8.5 4.5z" />
      <path d="M3.5 8.5v8L12 21l8.5-4.5v-8" />
      <path d="M12 12.9V21" />
    </svg>
  )
}
