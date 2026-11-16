import { bigserial, doublePrecision, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * First-party visit telemetry (docs/ops/admin-guide.md, "Telemetry"). Nothing here leaves the
 * deployment, and nothing here can place a visitor: no IP address, no location, no raw User-Agent,
 * no query string, no referrer. A session is one browser tab's visit; its id is random, made in the
 * browser, and kept in `sessionStorage` only.
 */

export const VISIT_PRINCIPAL_KINDS = ['anonymous', 'guest', 'admin'] as const;
export type VisitPrincipalKind = (typeof VISIT_PRINCIPAL_KINDS)[number];

export const VISIT_DEVICES = ['phone', 'tablet', 'desktop'] as const;
export type VisitDevice = (typeof VISIT_DEVICES)[number];

export const VISIT_EVENT_KINDS = ['view', 'error', 'vital'] as const;
export type VisitEventKind = (typeof VISIT_EVENT_KINDS)[number];

export const VISIT_EVENT_SOURCES = ['client', 'server'] as const;
export type VisitEventSource = (typeof VISIT_EVENT_SOURCES)[number];

export const visitSessions = pgTable(
  'visit_sessions',
  {
    /** Client-generated random id (`^[A-Za-z0-9_-]{16,40}$`). Not a credential: it names a tab, nothing more. */
    id: text('id').primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** A session that starts anonymous and signs in becomes `guest` (or `admin`); it never goes back. */
    principalKind: text('principal_kind').$type<VisitPrincipalKind>().notNull().default('anonymous'),
    /** The signed-in guest. No foreign key: deleting a guest must not depend on a housekeeping table. */
    guestId: text('guest_id'),
    device: text('device').$type<VisitDevice>().notNull(),
    /** Coarse family (`Chrome`, `Safari`, `Firefox`, `Edge`, `Other`), derived on the server. The User-Agent itself is never stored. */
    browser: text('browser').notNull(),
    entryPath: text('entry_path').notNull(),
    exitPath: text('exit_path').notNull(),
    pageviews: integer('pageviews').notNull().default(0),
    errors: integer('errors').notNull().default(0),
  },
  (t) => [index('visit_sessions_started_at_idx').on(t.startedAt), index('visit_sessions_guest_idx').on(t.guestId)],
);

export const visitEvents = pgTable(
  'visit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Null for server errors, and for errors from a browser that asked not to be tracked. */
    sessionId: text('session_id'),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    kind: text('kind').$type<VisitEventKind>().notNull(),
    source: text('source').$type<VisitEventSource>().notNull().default('client'),
    /** Pathname only, with secret-bearing segments collapsed (`/i/[token]`); see `sanitizePath`. */
    path: text('path').notNull(),
    /** A vital's name (`LCP`, `CLS`, `INP`) or an error's name (`TypeError`). */
    name: text('name'),
    /** A vital's value: milliseconds for LCP and INP, unitless for CLS. */
    value: doublePrecision('value'),
    /** An error's message, redacted and at most 300 characters. */
    message: text('message'),
    /** An error's top frames (at most 8, at most 2000 characters), with query strings removed. */
    stack: text('stack'),
    /** Stable hash of source, name, normalised message and top frame: what groups one fault. */
    fingerprint: text('fingerprint'),
  },
  (t) => [index('visit_events_session_idx').on(t.sessionId), index('visit_events_kind_at_idx').on(t.kind, t.at), index('visit_events_fingerprint_idx').on(t.fingerprint)],
);

export type VisitSessionRow = typeof visitSessions.$inferSelect;
export type VisitEventRow = typeof visitEvents.$inferSelect;
