import { destinationOf } from '@/domain/lifecycle/account';
import type { SVGProps } from 'react';

/** Authored line icons, one stroke weight, used by the nav, the action bar and external links. */
const PATHS: Record<string, string> = {
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  rsvp: 'M3 6h18v12H3zM3 7l9 6 9-6',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  suitcase: 'M5 8h14v12H5zM9 8V5h6v3M9 8v12M15 8v12',
  chat: 'M4 5h16v11H9l-5 4z',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  car: 'M5 16l1.5-5h11L19 16M3 16h18v3H3zM7 19v2M17 19v2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  book: 'M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-2 6-4 2 2-6z',
  building: 'M5 21V5l7-3 7 3v16M9 9h2M13 9h2M9 13h2M13 13h2M11 21v-4h2v4',
  gift: 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13M12 7c-3 0-4-3-2-3s2 3 2 3zM12 7c3 0 4-3 2-3s-2 3-2 3z',
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 16c6 0 4-8 10-8',
  external: 'M14 4h6v6M20 4l-9 9M18 13v7H4V6h7',
  sun: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  // The planner's controls and facts (src/components/trip): the shapes guests already know.
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  landmark: 'M3 9l9-5 9 5zM5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20.5h18',
  balloon: 'M12 15c-3 0-5.5-2.9-5.5-6.5a5.5 5.5 0 0 1 11 0C17.5 12.1 15 15 12 15zM12 15l-1 2h2zM12 17c0 1.5-1.5 2-.5 4',
  dinner: 'M7 3v5a2 2 0 0 0 4 0V3M9 3v5M9 10v11M17 21V3c-2 1.5-3 4-3 7v3h3',
  'calendar-plus': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 12.5v5M9.5 15h5',
  rings: 'M9 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 11L7.5 8.5 9 6l1.5 2.5z',
  sunrise: 'M3 18h18M7 18a5 5 0 0 1 10 0M12 5v3M5 10.5l1.5 1.5M19 10.5L17.5 12M8 21h8',
  moon: 'M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z',
  restart: 'M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 3.5v5h5',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M9 6l6 6-6 6',
  bed: 'M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  plane: 'M12 2.5c.8 0 1.4.7 1.4 1.5v5.3l7 4v2l-7-2v4.6l2 1.6v1.5l-3.4-1-3.4 1v-1.5l2-1.6V13.3l-7 2v-2l7-4V4c0-.8.6-1.5 1.4-1.5z',
  train: 'M6.5 4h11v11a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM6.5 10h11M9.5 13.5h.01M14.5 13.5h.01M9 17l-2 4M15 17l2 4',
  parking: 'M4 4h16v16H4zM10 16.5v-9h3a2.5 2.5 0 0 1 0 5h-3',
  tag: 'M3 12.5V4h8.5l9.5 9.5-8 8zM7.5 8.5h.01',
  key: 'M16 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM13.2 10.8L4 20M6.5 17.5l2 2M9 15l2 2',
  hanger: 'M10 6.5a2 2 0 1 1 3 1.7c-.6.4-1 .9-1 1.6V11M12 11l-8.5 5.5a1 1 0 0 0 .5 1.8h16a1 1 0 0 0 .5-1.8z',
};

export type IconName = keyof typeof PATHS;

/** `filled` paints the shape in the ink colour too: a saved heart, the stop square, the drag dots. */
export function Icon({ name, filled, ...rest }: { name: IconName; filled?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name] ?? PATHS.route} />
    </svg>
  );
}

/** Route → icon for the elevator panel. */
export function iconForHref(link: string): IconName {
  // A household page reached through the sign-in door keeps that page's icon.
  const href = destinationOf(link);
  if (href === '/' || href.startsWith('/#')) return 'home';
  if (href.startsWith('/rsvp')) return 'rsvp';
  if (href.startsWith('/guests/travel')) return 'suitcase';
  if (href.startsWith('/transportation')) return 'car';
  if (href.startsWith('/guests/ask-us')) return 'chat';
  if (href.startsWith('/photos')) return 'camera';
  if (href.startsWith('/our-story')) return 'book';
  if (href.startsWith('/our-adventures')) return 'compass';
  if (href.startsWith('/our-venue')) return 'building';
  if (href.startsWith('/guests')) return 'calendar';
  if (href.startsWith('/gifts')) return 'gift';
  if (href.startsWith('http')) return 'pin';
  return 'route';
}
