import type { SVGProps } from 'react';

/** Authored line icons, one stroke weight, used by the Gilded Hour elevator panel and external links. */
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
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name] ?? PATHS.route} />
    </svg>
  );
}

/** Route → icon for the elevator panel. */
export function iconForHref(href: string): IconName {
  if (href === '/' || href.startsWith('/#')) return 'home';
  if (href.startsWith('/rsvp')) return 'rsvp';
  if (href.startsWith('/your-weekend')) return 'calendar';
  if (href.startsWith('/travel')) return 'suitcase';
  if (href.startsWith('/transportation')) return 'car';
  if (href.startsWith('/ask-us')) return 'chat';
  if (href.startsWith('/photos')) return 'camera';
  if (href.startsWith('/our-story')) return 'book';
  if (href.startsWith('/our-adventures')) return 'compass';
  if (href.startsWith('/share-an-adventure')) return 'route';
  if (href.startsWith('/explore-caa')) return 'building';
  if (href.startsWith('/the-wedding')) return 'sun';
  if (href.startsWith('/gifts')) return 'gift';
  if (href.startsWith('http')) return 'pin';
  return 'route';
}
