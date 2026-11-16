import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { errorGroups, listSessions, sessionDetail, SESSION_ID_PATTERN, trafficRollup } from '@/domain/ops';
import { telemetryEnabled } from '@/lib/telemetry';
import { opsDb } from './_shared';

/**
 * The admin console's view of first-party visit telemetry (docs/ops/admin-guide.md, "Telemetry"):
 * traffic, sessions, one session, and grouped errors. All four are reads behind
 * `admin_integrations`, like the rest of the diagnostics screens, and website-only.
 *
 * `untrustedContentHint` is true on each: a page path, an error's name and its message were sent
 * by a visitor's browser. They are sanitised before they are stored (no query string, no token, no
 * email), but they are still text a stranger chose, and a consumer must treat them as data.
 */

const DEFAULT_WINDOW_HOURS = 168;
const windowHours = z.number().int().min(1).max(720).optional();
const annotations = { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } as const;
const exposure = { ui: true, ai: false, webmcp: false } as const;

// ---------------------------------------------------------------------------------------------
// admin_site_traffic
// ---------------------------------------------------------------------------------------------

const trafficInput = z.object({ windowHours }).optional();

const trafficOutput = z.object({
  windowHours: z.number().int(),
  since: z.string(),
  recording: z.boolean(),
  totals: z.object({
    sessions: z.number().int(),
    pageviews: z.number().int(),
    signedInSessions: z.number().int(),
    guests: z.number().int(),
    errors: z.number().int(),
    erroredSessions: z.number().int(),
    medianDurationSeconds: z.number().nullable(),
  }),
  previous: z.object({ sessions: z.number().int(), pageviews: z.number().int(), errors: z.number().int() }),
  series: z.array(z.object({ at: z.string(), sessions: z.number().int(), pageviews: z.number().int(), errors: z.number().int() })),
  topPages: z.array(z.object({ path: z.string(), views: z.number().int(), sessions: z.number().int(), errors: z.number().int() })),
  devices: z.array(z.object({ device: z.string(), sessions: z.number().int() })),
  browsers: z.array(z.object({ browser: z.string(), sessions: z.number().int() })),
  vitals: z.array(z.object({ name: z.enum(['LCP', 'CLS', 'INP']), p75: z.number(), samples: z.number().int() })),
});
export type SiteTrafficView = z.infer<typeof trafficOutput>;

/**
 * Visits over a window, with the window before it for comparison. `recording` is false under
 * `TELEMETRY=off`, so an empty chart is not read as an empty site. Sessions are counted by when
 * they started and page views and errors by when they happened, which is what makes `totals` the
 * sum of `series`.
 */
export const adminSiteTraffic = defineCapability<z.infer<typeof trafficInput>, SiteTrafficView>({
  name: 'admin_site_traffic',
  title: 'Site traffic',
  description:
    'Visits to this site over a time window (default 7 days): sessions, page views, signed-in sessions, distinct guests, errors, median visit length, the same counts for the window before, a continuous hourly or daily series, the most viewed pages, device and browser mix, and web vitals at the 75th percentile. First-party only: no IP addresses or locations exist to report. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations,
  exposure,
  input: trafficInput,
  output: trafficOutput,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const rollup = await trafficRollup(opsDb(ctx), { now: ctx.now, windowHours: i?.windowHours ?? DEFAULT_WINDOW_HOURS, recording: telemetryEnabled() });
    return ok({ data: rollup, sources: [] });
  },
});

// ---------------------------------------------------------------------------------------------
// admin_list_sessions, admin_session_detail
// ---------------------------------------------------------------------------------------------

const sessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  lastSeenAt: z.string(),
  durationSeconds: z.number().int(),
  who: z.object({ kind: z.enum(['anonymous', 'guest', 'admin']), guestId: z.string().optional(), name: z.string().optional() }),
  device: z.string(),
  browser: z.string(),
  entryPath: z.string(),
  exitPath: z.string(),
  pageviews: z.number().int(),
  errors: z.number().int(),
});

const sessionsInput = z
  .object({
    windowHours,
    limit: z.number().int().min(1).max(100).optional(),
    guestId: z.string().min(1).max(64).optional(),
    withErrors: z.boolean().optional(),
    path: z.string().min(1).max(200).optional(),
  })
  .optional();

const sessionsOutput = z.object({ total: z.number().int(), sessions: z.array(sessionSchema) });
export type SessionListView = z.infer<typeof sessionsOutput>;

export const adminListSessions = defineCapability<z.infer<typeof sessionsInput>, SessionListView>({
  name: 'admin_list_sessions',
  title: 'Visitor sessions',
  description:
    'Visitor sessions that started in a time window (default 7 days), newest first: when, how long, who (anonymous, a guest by name, or an administrator), device class, browser family, first and last page, page views and errors. Optional filters: one guest, only sessions with errors, only sessions that viewed a page. `total` counts every match, not only the page returned. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations,
  exposure,
  input: sessionsInput,
  output: sessionsOutput,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const result = await listSessions(opsDb(ctx), {
      now: ctx.now,
      windowHours: i?.windowHours ?? DEFAULT_WINDOW_HOURS,
      limit: i?.limit ?? 50,
      guestId: i?.guestId,
      withErrors: i?.withErrors,
      path: i?.path,
    });
    return ok({ data: result, sources: [] });
  },
});

const detailInput = z.object({ sessionId: z.string().regex(SESSION_ID_PATTERN) });

const detailOutput = z.object({
  session: sessionSchema,
  events: z.array(
    z.object({
      at: z.string(),
      kind: z.enum(['view', 'error', 'vital']),
      path: z.string(),
      name: z.string().optional(),
      value: z.number().optional(),
      message: z.string().optional(),
    }),
  ),
});
export type SessionDetailView = z.infer<typeof detailOutput>;

export const adminSessionDetail = defineCapability<z.infer<typeof detailInput>, SessionDetailView>({
  name: 'admin_session_detail',
  title: 'One visitor session',
  description: 'One visitor session and what happened in it, oldest first (at most 500 events): each page viewed, each web vital measured and each error hit, with its time and page. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations,
  exposure,
  input: detailInput,
  output: detailOutput,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const detail = await sessionDetail(opsDb(ctx), i.sessionId);
    if (!detail) return err(new CapabilityError('not_found', 'No session with that id.'));
    return ok({ data: detail, sources: [] });
  },
});

// ---------------------------------------------------------------------------------------------
// admin_site_errors
// ---------------------------------------------------------------------------------------------

const errorsInput = z.object({ windowHours, limit: z.number().int().min(1).max(50).optional() }).optional();

const errorsOutput = z.object({
  windowHours: z.number().int(),
  total: z.number().int(),
  groups: z.array(
    z.object({
      fingerprint: z.string(),
      message: z.string(),
      name: z.string().nullable(),
      source: z.enum(['client', 'server']),
      count: z.number().int(),
      sessions: z.number().int(),
      firstAt: z.string(),
      lastAt: z.string(),
      paths: z.array(z.string()),
      sample: z.object({ path: z.string(), stack: z.string().optional(), sessionId: z.string().optional() }),
    }),
  ),
});
export type SiteErrorsView = z.infer<typeof errorsOutput>;

export const adminSiteErrors = defineCapability<z.infer<typeof errorsInput>, SiteErrorsView>({
  name: 'admin_site_errors',
  title: 'Site errors',
  description:
    'Errors visitors hit over a time window (default 7 days), grouped so one fault is one row, most frequent first: the message, whether the browser or the server raised it, how many times and in how many sessions, first and last seen, up to five pages it happened on, and the most recent occurrence with its top stack frames. `total` counts every error event in the window. Messages are redacted before they are stored. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations,
  exposure,
  input: errorsInput,
  output: errorsOutput,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const result = await errorGroups(opsDb(ctx), { now: ctx.now, windowHours: i?.windowHours ?? DEFAULT_WINDOW_HOURS, limit: i?.limit ?? 25 });
    return ok({ data: result, sources: [] });
  },
});
