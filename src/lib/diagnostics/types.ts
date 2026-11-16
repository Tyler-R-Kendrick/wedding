/**
 * What the browser's flight recorder keeps (src/lib/diagnostics/recorder.ts), and what an error
 * report or a problem report carries from it. Plain data, shared by the browser and the server.
 *
 * Nothing here says who the reader is. A step is "clicked button.btn--primary", never the words on
 * the button; an address is a path with its query values and long ids removed (./scrub.ts).
 */
export type BreadcrumbKind = 'nav' | 'click' | 'http' | 'console' | 'error' | 'page' | 'note';

export interface Breadcrumb {
  /** Milliseconds since the epoch. */
  t: number;
  kind: BreadcrumbKind;
  text: string;
}

export type ErrorSource = 'error' | 'rejection' | 'boundary' | 'console';

export interface CapturedError {
  t: number;
  source: ErrorSource;
  message: string;
  stack?: string;
  /** Next's id for a server-side failure: the same string the server logged it under. */
  digest?: string;
}

export interface Diagnostics {
  /** Random per browser tab, kept in sessionStorage. Joins one visit's reports; names nobody. */
  session: string;
  /** The deployed commit, short. `dev` on a local checkout. */
  build: string;
  path: string;
  title: string;
  viewport: string;
  userAgent: string;
  language: string;
  timeZone: string;
  online: boolean;
  startedAt: number;
  capturedAt: number;
  errors: CapturedError[];
  breadcrumbs: Breadcrumb[];
  /** This visit in the hosted session tracker, when one is connected (src/lib/observe). */
  links?: { session?: string; replay?: string };
}

export const MAX_BREADCRUMBS = 50;
export const MAX_ERRORS = 10;
export const MAX_STACK_CHARS = 4_000;
export const MAX_TEXT_CHARS = 300;

/** Where the browser sends an error it caught. */
export const PULSE_PATH = '/api/pulse';
