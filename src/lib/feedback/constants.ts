/**
 * The problem reporter's fixed points, shared by the browser and the server. No imports: the inline
 * script in the root layout and the fallback form are built from these too.
 */

/** GET: the plain form. POST: file a report. DELETE: forget this device. */
export const FEEDBACK_PATH = '/api/feedback';

/** Signed proof that this browser belongs to one of the couple (./pass.ts). httpOnly. */
export const REPORTER_PASS_COOKIE = 'wedding.reporter';

/**
 * A plain marker in localStorage: "this device has reported before", so the shortcut is armed
 * without asking the server. It grants nothing. The server reads the cookie, never this.
 */
export const REPORTER_FLAG_KEY = 'wedding:reporter';

/** Reports written while the site could not take them, waiting to be sent (browser only). */
export const REPORTER_OUTBOX_KEY = 'wedding:reporter:outbox';

/** The window hook the widget installs; the inline script calls it, or falls back to the plain form. */
export const REPORTER_GLOBAL = '__weddingReport';

/** Fired on `window` to open the reporter from anywhere, with an optional `{ digest }` detail. */
export const REPORTER_EVENT = 'wedding:report';

/**
 * Alt+Shift+B (Option+Shift+B on a Mac). A chord with two modifiers, so it never fires while
 * typing a letter (WCAG 2.1.4), and one no browser or screen reader has taken. Matched on the
 * physical key (`code`), because Option+Shift+B types a character on a Mac keyboard.
 */
export const REPORTER_HOTKEY = { code: 'KeyB', altKey: true, shiftKey: true, label: 'Alt+Shift+B', macLabel: '⌥⇧B' } as const;

export const FEEDBACK_KINDS = ['bug', 'content', 'idea'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Something is broken',
  content: 'Something is wrong or missing',
  idea: 'An idea',
};

export const MAX_MESSAGE_CHARS = 4_000;
/** Under Vercel's 4.5 MB request cap with room for the rest of the form. */
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
/** The longest edge a screenshot is scaled to in the browser before it is sent. */
export const SCREENSHOT_MAX_EDGE = 1_600;
