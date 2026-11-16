import type { SVGProps } from 'react';

/**
 * The console's own line icons: a 24 grid, one 1.5 stroke, round joins, the same hand as the guest
 * site's (`themes/shared/icons`). They are here rather than there because none of them is a thing a
 * guest ever sees: a queue, a flag, a ledger.
 */
const PATHS = {
  overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  ask: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  guests: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.3c2.1.8 3.5 2.8 3.5 5.7',
  household: 'M3.5 11.5L12 4l8.5 7.5M5.5 10v10h13V10M10 20v-5h4v5',
  invitation: 'M3 6h18v12H3zM3 7l9 6 9-6',
  rsvp: 'M5 4h14v16H5zM8.5 9l1.5 1.5L13 7.5M8.5 15l1.5 1.5 3-3M15.5 9.5h.5M15.5 15.5h.5',
  seating: 'M12 15a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 3v1M12 17v4M3 10.5h2.5M18.5 10.5H21M5.6 4.6l1.8 1.8M16.6 6.4l1.8-1.8',
  events: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3M8 17h6',
  travel: 'M3 18h18M5 18v-6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6M8 9V7M16 9V7M5 14h14',
  transport: 'M5 16l1.5-5h11L19 16M3 16h18v3H3zM7 19v2M17 19v2',
  gifts: 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13M12 7c-3 0-4-3-2-3s2 3 2 3zM12 7c3 0 4-3 2-3s-2 3-2 3z',
  reservations: 'M7 3v5a2 2 0 0 0 4 0V3M9 3v5M9 10v11M17 21V3c-2 1.5-3 4-3 7v3h3',
  lifecycle: 'M5 6a2 2 0 1 0 0 .01M12 12a2 2 0 1 0 0 .01M19 18a2 2 0 1 0 0 .01M7 6h4a2 2 0 0 1 2 2v2M14 12h3a2 2 0 0 1 2 2v2',
  content: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  flags: 'M5 21V4M5 5h11l-2 3.5 2 3.5H5',
  sitemap: 'M10 3h4v4h-4zM3 17h4v4H3zM10 17h4v4h-4zM17 17h4v4h-4zM12 7v5M5 17v-3h14v3M12 12v5',
  media: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  index: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8.5 11h5M11 8.5v5',
  concierge: 'M4 5h16v11H9l-5 4z',
  sessions: 'M3 12h4l2.5-6 4 12 2.5-6h5',
  errors: 'M12 3l9.5 17h-19zM12 10v4.5M12 17.5h.01',
  metrics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  audit: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  jobs: 'M4 7h16M4 12h10M4 17h7M18 14v6M15 17l3 3 3-3',
  providers: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5h.01',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  up: 'M12 19V6M6.5 11.5L12 6l5.5 5.5',
  down: 'M12 5v13M6.5 12.5L12 18l5.5-5.5',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  new: 'M12 5v14M5 12h14',
  sheet: 'M4 5h16v14H4zM4 10h16M4 14.5h16M9.5 5v14M15 5v14',
  details: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4M3 8h2M3 12h2M3 16h2',
  schedule: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 13.5h2M8 16.5h2M12.5 13.5h3.5M12.5 16.5h3.5',
} as const;

export type AdminIconName = keyof typeof PATHS;

export const isAdminIcon = (name: unknown): name is AdminIconName => typeof name === 'string' && name in PATHS;

/** Decorative by default: the label next to it is the name. Pass `title` only when it stands alone. */
export function AdminIcon({ name, title, ...rest }: { name: AdminIconName; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false" {...rest}>
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
