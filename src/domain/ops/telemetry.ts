import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { guests, visitEvents, visitSessions, type VisitEventKind, type VisitEventSource, type VisitPrincipalKind } from '@/db/schema';
import { chicagoLocalToIso } from '@/domain/events/format';
import { browserFamily, deviceClass, errorFingerprint, isSessionId, sanitizeMessage, sanitizeName, sanitizePath, sanitizeStack } from './telemetry-sanitize';

/**
 * First-party visit telemetry: what is written (`recordTelemetry`, `recordServerError`), what is
 * read back for the admin console (`trafficRollup`, `listSessions`, `sessionDetail`,
 * `errorGroups`) and what is deleted (`purgeTelemetry`). Like `metricsRollup`, every read is
 * aggregated in SQL, and the SQL is the subset PGlite and Postgres share.
 */

export const TELEMETRY_MAX_EVENTS_PER_CALL = 20;
export const TELEMETRY_TIME_ZONE = 'America/Chicago';
export const VITAL_NAMES = ['LCP', 'CLS', 'INP'] as const;
export type VitalName = (typeof VITAL_NAMES)[number];
/** Upper bounds a real page cannot exceed; anything above is a broken or hostile client. */
const VITAL_MAX: Record<VitalName, number> = { LCP: 600_000, CLS: 100, INP: 600_000 };
/** A batch is flushed within seconds, so an event's own clock is believed only this far back. */
const MAX_EVENT_AGE_MS = 10 * 60_000;
const MAX_EVENT_AHEAD_MS = 5_000;
export const SESSION_EVENTS_MAX = 500;

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

export interface TelemetryEventInput {
  kind: VisitEventKind;
  path: string;
  /** The browser's own time for the event (epoch ms, ISO string or Date). Used only when it is close to `now`. */
  at?: number | string | Date;
  name?: string | null;
  value?: number | null;
  message?: string | null;
  stack?: string | null;
}

export interface RecordTelemetryInput {
  /** Null when the browser asked not to be tracked: then only errors are kept, tied to no session. */
  sessionId: string | null;
  principal: Principal;
  /** Read for the device class and browser family, then discarded. */
  userAgent: string | null;
  events: readonly TelemetryEventInput[];
  now: Date;
}

export interface RecordTelemetryResult {
  /** Events written. */
  stored: number;
  /** Whether a session row was created or updated. */
  session: boolean;
}

type EventInsert = typeof visitEvents.$inferInsert;

/** Who a visit is attributed to. An administrator browsing as a guest is an administrator, not that guest. */
export function telemetryActor(principal: Principal): { kind: VisitPrincipalKind; guestId: string | null } {
  if (principal.kind === 'guest') return principal.viewedBy ? { kind: 'admin', guestId: null } : { kind: 'guest', guestId: principal.guestId };
  if (principal.kind === 'admin') return { kind: 'admin', guestId: null };
  return { kind: 'anonymous', guestId: null };
}

function eventTime(at: TelemetryEventInput['at'], now: Date): Date {
  if (at === undefined || at === null) return now;
  const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return now;
  return t >= now.getTime() - MAX_EVENT_AGE_MS && t <= now.getTime() + MAX_EVENT_AHEAD_MS ? new Date(Math.min(t, now.getTime())) : now;
}

/** One event reduced to what may be stored, or null when it is not a well-formed event of its kind. */
export function cleanEvent(e: TelemetryEventInput, opts: { now: Date; source: VisitEventSource; sessionId: string | null; root?: string }): EventInsert | null {
  const base = { sessionId: opts.sessionId, at: eventTime(e.at, opts.now), source: opts.source, path: sanitizePath(e.path) };
  if (e.kind === 'view') return { ...base, kind: 'view' };
  if (e.kind === 'vital') {
    const name = VITAL_NAMES.find((n) => n === e.name);
    const value = typeof e.value === 'number' ? e.value : NaN;
    if (!name || !Number.isFinite(value) || value < 0 || value > VITAL_MAX[name]) return null;
    return { ...base, kind: 'vital', name, value };
  }
  if (e.kind === 'error') {
    const name = sanitizeName(e.name);
    const message = sanitizeMessage(e.message) || 'Unknown error';
    const stack = sanitizeStack(e.stack, { root: opts.root });
    return { ...base, kind: 'error', name, message, stack, fingerprint: errorFingerprint({ source: opts.source, name, message, stack }) };
  }
  return null;
}

/**
 * Writes one batch from a browser. With a session id: the session row is created or moved along
 * (counters, last seen, exit page, and who it is once the visitor signs in) and every event is
 * kept. Without one, only errors are kept, attached to nothing: a fault is a fact about the site,
 * a page view is a fact about a person.
 */
export async function recordTelemetry(db: Db, input: RecordTelemetryInput): Promise<RecordTelemetryResult> {
  const sessionId = isSessionId(input.sessionId) ? input.sessionId : null;
  const rows: EventInsert[] = [];
  for (const e of input.events.slice(0, TELEMETRY_MAX_EVENTS_PER_CALL)) {
    const row = cleanEvent(e, { now: input.now, source: 'client', sessionId });
    if (row && (sessionId || row.kind === 'error')) rows.push(row);
  }
  if (rows.length === 0) return { stored: 0, session: false };

  if (sessionId) {
    const actor = telemetryActor(input.principal);
    const views = rows.filter((r) => r.kind === 'view');
    const errors = rows.filter((r) => r.kind === 'error').length;
    const times = rows.map((r) => (r.at as Date).getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    const exitPath = views.at(-1)?.path;
    await db
      .insert(visitSessions)
      .values({
        id: sessionId,
        startedAt: first,
        lastSeenAt: last,
        principalKind: actor.kind,
        guestId: actor.guestId,
        device: deviceClass(input.userAgent),
        browser: browserFamily(input.userAgent),
        entryPath: views[0]?.path ?? rows[0]!.path,
        exitPath: exitPath ?? rows.at(-1)!.path,
        pageviews: views.length,
        errors,
      })
      .onConflictDoUpdate({
        target: visitSessions.id,
        set: {
          lastSeenAt: sql`greatest(${visitSessions.lastSeenAt}, ${ts(last)})`,
          pageviews: sql`${visitSessions.pageviews} + ${views.length}`,
          errors: sql`${visitSessions.errors} + ${errors}`,
          ...(exitPath ? { exitPath } : {}),
          // Signing in names the session; a later anonymous batch (signed out, same tab) does not un-name it.
          ...(actor.kind !== 'anonymous' ? { principalKind: actor.kind, guestId: actor.guestId } : {}),
        },
      });
  }
  await db.insert(visitEvents).values(rows);
  return { stored: rows.length, session: sessionId !== null };
}

export interface ServerErrorInput {
  path: string;
  name?: string | null;
  message: string;
  stack?: string | null;
  now: Date;
  /** The server's working directory, removed from stack frames. */
  root?: string;
}

/** One error the server hit while answering a request. No session, no headers, no query string. */
export async function recordServerError(db: Db, input: ServerErrorInput): Promise<void> {
  const row = cleanEvent({ kind: 'error', path: input.path, name: input.name, message: input.message, stack: input.stack }, { now: input.now, source: 'server', sessionId: null, root: input.root });
  if (row) await db.insert(visitEvents).values(row);
}

/** Deletes events from before `olderThan` and sessions last seen before it. */
export async function purgeTelemetry(db: Db, olderThan: Date): Promise<{ sessions: number; events: number }> {
  const events = await db.delete(visitEvents).where(lt(visitEvents.at, olderThan)).returning({ id: visitEvents.id });
  const sessions = await db.delete(visitSessions).where(lt(visitSessions.lastSeenAt, olderThan)).returning({ id: visitSessions.id });
  return { sessions: sessions.length, events: events.length };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export interface TrafficRollup {
  windowHours: number;
  since: string;
  /** False when `TELEMETRY=off`: an empty window then means "not recording", not "nobody came". */
  recording: boolean;
  totals: { sessions: number; pageviews: number; signedInSessions: number; guests: number; errors: number; erroredSessions: number; medianDurationSeconds: number | null };
  /** The window of equal length immediately before `since`. */
  previous: { sessions: number; pageviews: number; errors: number };
  /** Hourly when the window is 48 hours or less, else one bucket per America/Chicago day. Empty buckets are included. */
  series: { at: string; sessions: number; pageviews: number; errors: number }[];
  topPages: { path: string; views: number; sessions: number; errors: number }[];
  devices: { device: string; sessions: number }[];
  browsers: { browser: string; sessions: number }[];
  vitals: { name: VitalName; p75: number; samples: number }[];
}

export const TRAFFIC_HOURLY_MAX_HOURS = 48;
export const TRAFFIC_TOP_PAGES = 15;

const chicagoDate = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: TELEMETRY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** The buckets a window covers, oldest first: each with the key SQL groups by and the instant it starts. */
export function trafficBuckets(since: Date, now: Date, hourly: boolean): { key: string; at: string }[] {
  const out: { key: string; at: string }[] = [];
  if (hourly) {
    const end = Math.floor(now.getTime() / 3_600_000);
    for (let h = Math.floor(since.getTime() / 3_600_000); h <= end; h++) {
      const at = new Date(h * 3_600_000).toISOString();
      out.push({ key: at.slice(0, 13), at });
    }
    return out;
  }
  const last = chicagoDate(now);
  // Walk calendar days at noon UTC: a day is never skipped or repeated by a DST change that way.
  const [y, m, d] = chicagoDate(since).split('-').map(Number) as [number, number, number];
  for (let i = 0; i < 400; i++) {
    const key = new Date(Date.UTC(y, m - 1, d + i, 12)).toISOString().slice(0, 10);
    out.push({ key, at: chicagoLocalToIso(`${key}T00:00`, TELEMETRY_TIME_ZONE) ?? `${key}T06:00:00.000Z` });
    if (key >= last) break;
  }
  return out;
}

// No bound parameters in these: a GROUP BY expression only matches the selected one when neither holds a parameter of its own.
const hourKey = (col: typeof visitEvents.at | typeof visitSessions.startedAt): SQL<string> => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24')`;
const dayKey = (col: typeof visitEvents.at | typeof visitSessions.startedAt): SQL<string> => sql<string>`to_char(${col} at time zone 'America/Chicago', 'YYYY-MM-DD')`;

export async function trafficRollup(db: Db, opts: { now: Date; windowHours: number; recording: boolean }): Promise<TrafficRollup> {
  const windowMs = opts.windowHours * 3_600_000;
  const since = new Date(opts.now.getTime() - windowMs);
  const before = new Date(since.getTime() - windowMs);
  const hourly = opts.windowHours <= TRAFFIC_HOURLY_MAX_HOURS;
  const sessionKey = hourly ? hourKey(visitSessions.startedAt) : dayKey(visitSessions.startedAt);
  const eventKey = hourly ? hourKey(visitEvents.at) : dayKey(visitEvents.at);
  // The window is closed at both ends, so a rollup "as of" an earlier moment does not count what came after it.
  const sessionsInWindow = and(gte(visitSessions.startedAt, since), lte(visitSessions.startedAt, opts.now));
  const eventsInWindow = and(gte(visitEvents.at, since), lte(visitEvents.at, opts.now));

  const [totals] = await db
    .select({
      sessions: sql<number>`count(*)::int`,
      signedIn: sql<number>`(count(*) filter (where ${visitSessions.principalKind} <> 'anonymous'))::int`,
      guests: sql<number>`count(distinct ${visitSessions.guestId})::int`,
      errored: sql<number>`(count(*) filter (where ${visitSessions.errors} > 0))::int`,
      median: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${visitSessions.lastSeenAt} - ${visitSessions.startedAt})))`,
    })
    .from(visitSessions)
    .where(sessionsInWindow);

  const [previousSessions] = await db
    .select({ sessions: sql<number>`count(*)::int` })
    .from(visitSessions)
    .where(and(gte(visitSessions.startedAt, before), lt(visitSessions.startedAt, since)));
  const [previousEvents] = await db
    .select({
      pageviews: sql<number>`(count(*) filter (where ${visitEvents.kind} = 'view'))::int`,
      errors: sql<number>`(count(*) filter (where ${visitEvents.kind} = 'error'))::int`,
    })
    .from(visitEvents)
    .where(and(gte(visitEvents.at, before), lt(visitEvents.at, since), inArray(visitEvents.kind, ['view', 'error'])));

  const sessionSeries = await db.select({ key: sessionKey, sessions: sql<number>`count(*)::int` }).from(visitSessions).where(sessionsInWindow).groupBy(sessionKey);
  const eventSeries = await db
    .select({
      key: eventKey,
      pageviews: sql<number>`(count(*) filter (where ${visitEvents.kind} = 'view'))::int`,
      errors: sql<number>`(count(*) filter (where ${visitEvents.kind} = 'error'))::int`,
    })
    .from(visitEvents)
    .where(and(eventsInWindow, inArray(visitEvents.kind, ['view', 'error'])))
    .groupBy(eventKey);

  const sessionsByKey = new Map(sessionSeries.map((r) => [r.key, num(r.sessions)]));
  const eventsByKey = new Map(eventSeries.map((r) => [r.key, { pageviews: num(r.pageviews), errors: num(r.errors) }]));
  const series = trafficBuckets(since, opts.now, hourly).map((b) => ({
    at: b.at,
    sessions: sessionsByKey.get(b.key) ?? 0,
    pageviews: eventsByKey.get(b.key)?.pageviews ?? 0,
    errors: eventsByKey.get(b.key)?.errors ?? 0,
  }));

  const views = sql<number>`(count(*) filter (where ${visitEvents.kind} = 'view'))::int`;
  const pages = await db
    .select({
      path: visitEvents.path,
      views,
      sessions: sql<number>`(count(distinct ${visitEvents.sessionId}) filter (where ${visitEvents.kind} = 'view'))::int`,
      errors: sql<number>`(count(*) filter (where ${visitEvents.kind} = 'error'))::int`,
    })
    .from(visitEvents)
    .where(and(eventsInWindow, inArray(visitEvents.kind, ['view', 'error'])))
    .groupBy(visitEvents.path)
    .having(sql`count(*) filter (where ${visitEvents.kind} = 'view') > 0`)
    .orderBy(desc(views), asc(visitEvents.path))
    .limit(TRAFFIC_TOP_PAGES);

  const devices = await db.select({ device: visitSessions.device, sessions: sql<number>`count(*)::int` }).from(visitSessions).where(sessionsInWindow).groupBy(visitSessions.device);
  const browsers = await db.select({ browser: visitSessions.browser, sessions: sql<number>`count(*)::int` }).from(visitSessions).where(sessionsInWindow).groupBy(visitSessions.browser);

  const vitalRows = await db
    .select({
      name: visitEvents.name,
      p75: sql<number | null>`percentile_cont(0.75) within group (order by ${visitEvents.value})`,
      samples: sql<number>`count(*)::int`,
    })
    .from(visitEvents)
    .where(and(eventsInWindow, eq(visitEvents.kind, 'vital'), isNotNull(visitEvents.value)))
    .groupBy(visitEvents.name);
  const vitals = VITAL_NAMES.flatMap((name) => {
    const row = vitalRows.find((r) => r.name === name);
    if (!row || num(row.samples) === 0) return [];
    // CLS is a unitless score that matters to the second decimal; the others are whole milliseconds.
    const p75 = name === 'CLS' ? Math.round(num(row.p75) * 1000) / 1000 : Math.round(num(row.p75));
    return [{ name, p75, samples: num(row.samples) }];
  });

  const bySessions = <T extends { sessions: number }>(rows: T[], label: (r: T) => string) => rows.map((r) => ({ ...r, sessions: num(r.sessions) })).sort((a, b) => b.sessions - a.sessions || label(a).localeCompare(label(b)));
  const sessions = num(totals?.sessions);

  return {
    windowHours: opts.windowHours,
    since: since.toISOString(),
    recording: opts.recording,
    totals: {
      sessions,
      pageviews: series.reduce((t, b) => t + b.pageviews, 0),
      signedInSessions: num(totals?.signedIn),
      guests: num(totals?.guests),
      errors: series.reduce((t, b) => t + b.errors, 0),
      erroredSessions: num(totals?.errored),
      medianDurationSeconds: sessions > 0 && totals?.median !== null && totals?.median !== undefined ? Math.round(num(totals.median)) : null,
    },
    previous: { sessions: num(previousSessions?.sessions), pageviews: num(previousEvents?.pageviews), errors: num(previousEvents?.errors) },
    series,
    topPages: pages.map((p) => ({ path: p.path, views: num(p.views), sessions: num(p.sessions), errors: num(p.errors) })),
    devices: bySessions(devices, (r) => r.device),
    browsers: bySessions(browsers, (r) => r.browser),
    vitals,
  };
}

export interface SessionView {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  who: { kind: VisitPrincipalKind; guestId?: string; name?: string };
  device: string;
  browser: string;
  entryPath: string;
  exitPath: string;
  pageviews: number;
  errors: number;
}

const sessionColumns = {
  id: visitSessions.id,
  startedAt: visitSessions.startedAt,
  lastSeenAt: visitSessions.lastSeenAt,
  principalKind: visitSessions.principalKind,
  guestId: visitSessions.guestId,
  device: visitSessions.device,
  browser: visitSessions.browser,
  entryPath: visitSessions.entryPath,
  exitPath: visitSessions.exitPath,
  pageviews: visitSessions.pageviews,
  errors: visitSessions.errors,
  firstName: guests.firstName,
  lastName: guests.lastName,
};

type SessionRow = { id: string; startedAt: Date; lastSeenAt: Date; principalKind: VisitPrincipalKind; guestId: string | null; device: string; browser: string; entryPath: string; exitPath: string; pageviews: number; errors: number; firstName: string | null; lastName: string | null };

function toSessionView(r: SessionRow): SessionView {
  const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    durationSeconds: Math.max(0, Math.round((r.lastSeenAt.getTime() - r.startedAt.getTime()) / 1000)),
    who: { kind: r.principalKind, ...(r.guestId ? { guestId: r.guestId } : {}), ...(r.guestId && name ? { name } : {}) },
    device: r.device,
    browser: r.browser,
    entryPath: r.entryPath,
    exitPath: r.exitPath,
    pageviews: r.pageviews,
    errors: r.errors,
  };
}

export interface SessionFilter {
  now: Date;
  windowHours: number;
  limit: number;
  guestId?: string;
  /** Only sessions that hit at least one error. */
  withErrors?: boolean;
  /** Only sessions that viewed this page. */
  path?: string;
}

/** Sessions that started in the window, newest first, with the guest's name when the visitor was signed in. */
export async function listSessions(db: Db, f: SessionFilter): Promise<{ total: number; sessions: SessionView[] }> {
  const since = new Date(f.now.getTime() - f.windowHours * 3_600_000);
  const where = and(
    gte(visitSessions.startedAt, since),
    lte(visitSessions.startedAt, f.now),
    f.guestId ? eq(visitSessions.guestId, f.guestId) : undefined,
    f.withErrors ? gt(visitSessions.errors, 0) : undefined,
    f.path
      ? sql`exists (select 1 from ${visitEvents} where ${visitEvents.sessionId} = ${visitSessions.id} and ${visitEvents.kind} = 'view' and ${visitEvents.path} = ${sanitizePath(f.path)})`
      : undefined,
  );
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(visitSessions).where(where);
  const rows = await db
    .select(sessionColumns)
    .from(visitSessions)
    .leftJoin(guests, eq(guests.id, visitSessions.guestId))
    .where(where)
    .orderBy(desc(visitSessions.startedAt), asc(visitSessions.id))
    .limit(f.limit);
  return { total: num(count?.total), sessions: rows.map(toSessionView) };
}

export interface SessionEventView {
  at: string;
  kind: VisitEventKind;
  path: string;
  name?: string;
  value?: number;
  message?: string;
}

/** One session and what happened in it, oldest first (at most 500 events). Null when there is no such session. */
export async function sessionDetail(db: Db, sessionId: string): Promise<{ session: SessionView; events: SessionEventView[] } | null> {
  if (!isSessionId(sessionId)) return null;
  const [row] = await db.select(sessionColumns).from(visitSessions).leftJoin(guests, eq(guests.id, visitSessions.guestId)).where(eq(visitSessions.id, sessionId)).limit(1);
  if (!row) return null;
  const events = await db
    .select({ at: visitEvents.at, kind: visitEvents.kind, path: visitEvents.path, name: visitEvents.name, value: visitEvents.value, message: visitEvents.message })
    .from(visitEvents)
    .where(eq(visitEvents.sessionId, sessionId))
    .orderBy(asc(visitEvents.at), asc(visitEvents.id))
    .limit(SESSION_EVENTS_MAX);
  return {
    session: toSessionView(row),
    events: events.map((e) => ({
      at: e.at.toISOString(),
      kind: e.kind,
      path: e.path,
      ...(e.name ? { name: e.name } : {}),
      ...(e.value !== null ? { value: e.value } : {}),
      ...(e.message ? { message: e.message } : {}),
    })),
  };
}

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  name: string | null;
  source: VisitEventSource;
  count: number;
  /** Distinct sessions that hit it. Server errors and untracked browsers have no session and add nothing here. */
  sessions: number;
  firstAt: string;
  lastAt: string;
  /** Up to five pages it happened on. */
  paths: string[];
  /** The most recent occurrence. */
  sample: { path: string; stack?: string; sessionId?: string };
}

export const ERROR_GROUP_PATHS = 5;

/** Errors in the window grouped by fingerprint, most frequent first. `total` counts error events, across every group. */
export async function errorGroups(db: Db, opts: { now: Date; windowHours: number; limit: number }): Promise<{ windowHours: number; total: number; groups: ErrorGroup[] }> {
  const since = new Date(opts.now.getTime() - opts.windowHours * 3_600_000);
  const inWindow = and(eq(visitEvents.kind, 'error'), gte(visitEvents.at, since), lte(visitEvents.at, opts.now));
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(visitEvents).where(inWindow);

  const occurrences = sql<number>`count(*)::int`;
  const lastAt = sql<string>`max(${visitEvents.at})`;
  const aggregates = await db
    .select({
      fingerprint: visitEvents.fingerprint,
      count: occurrences,
      sessions: sql<number>`count(distinct ${visitEvents.sessionId})::int`,
      firstAt: sql<string>`min(${visitEvents.at})`,
      lastAt,
      // Sanitised paths hold no whitespace, so a newline is a safe separator on both drivers.
      paths: sql<string>`string_agg(distinct ${visitEvents.path}, E'\n')`,
    })
    .from(visitEvents)
    .where(and(inWindow, isNotNull(visitEvents.fingerprint)))
    .groupBy(visitEvents.fingerprint)
    .orderBy(desc(occurrences), desc(lastAt), asc(visitEvents.fingerprint))
    .limit(opts.limit);
  if (aggregates.length === 0) return { windowHours: opts.windowHours, total: num(count?.total), groups: [] };

  const fingerprints = aggregates.map((a) => a.fingerprint!);
  const samples = await db
    .selectDistinctOn([visitEvents.fingerprint], {
      fingerprint: visitEvents.fingerprint,
      message: visitEvents.message,
      name: visitEvents.name,
      source: visitEvents.source,
      path: visitEvents.path,
      stack: visitEvents.stack,
      sessionId: visitEvents.sessionId,
    })
    .from(visitEvents)
    .where(and(inWindow, inArray(visitEvents.fingerprint, fingerprints)))
    .orderBy(asc(visitEvents.fingerprint), desc(visitEvents.at), desc(visitEvents.id));
  const sampleBy = new Map(samples.map((s) => [s.fingerprint, s]));

  const groups = aggregates.flatMap((a): ErrorGroup[] => {
    const s = sampleBy.get(a.fingerprint);
    if (!s || !a.fingerprint) return [];
    return [
      {
        fingerprint: a.fingerprint,
        message: s.message ?? 'Unknown error',
        name: s.name,
        source: s.source,
        count: num(a.count),
        sessions: num(a.sessions),
        firstAt: iso(a.firstAt),
        lastAt: iso(a.lastAt),
        paths: (a.paths ?? '').split('\n').filter(Boolean).sort().slice(0, ERROR_GROUP_PATHS),
        sample: { path: s.path, ...(s.stack ? { stack: s.stack } : {}), ...(s.sessionId ? { sessionId: s.sessionId } : {}) },
      },
    ];
  });
  return { windowHours: opts.windowHours, total: num(count?.total), groups };
}
