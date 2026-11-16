import { stateLabel } from '@/domain/lifecycle/words';
import type { LifecycleState } from '@/contracts/lifecycle';
import type { ReadTool } from './catalog';
import type { Audit, ErrorGroups, Jobs, Lifecycle, Metrics, Rsvp, SessionDetail, SessionList, SessionRow, Traffic } from './types';

/**
 * A capability's output, reduced to what an answer shows: labels in words, times in Chicago, deltas
 * worked out, rows capped. It runs in two places with one result — on the server, for the data an
 * answer is composed with, and in the browser, on what a live `Query(...)` brings back — so a
 * program reads the same fields whichever it is looking at.
 *
 * Pure and isomorphic: no database, no clock (callers pass nothing; every time comes from the data).
 */

const ZONE = 'America/Chicago';
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, ...options });
const DAY = fmt({ weekday: 'short', day: 'numeric' });
const HOUR = fmt({ hour: 'numeric' });
const STAMP = fmt({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const CLOCK = fmt({ hour: 'numeric', minute: '2-digit', second: '2-digit' });

const valid = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : null);
export const stamp = (iso: string | null | undefined) => {
  const d = valid(iso);
  return d ? STAMP.format(d) : '—';
};
const clock = (iso: string) => {
  const d = valid(iso);
  return d ? CLOCK.format(d) : '';
};
export const count = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export type Delta = { text: string; tone: 'success' | 'danger' | 'neutral' } | null;
/** Change against the window before. `moreIsGood` false is for errors, where a rise is bad news. */
export function delta(now: number, before: number, moreIsGood = true): Delta {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: 'No change', tone: 'neutral' };
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 === moreIsGood ? 'success' : 'danger' };
}

/** Core Web Vitals thresholds (web.dev): good at or under the first, poor over the second. */
const VITALS: Record<string, { good: number; poor: number; unit: 's' | 'ms' | ''; label: string }> = {
  LCP: { good: 2500, poor: 4000, unit: 's', label: 'Largest paint (LCP)' },
  INP: { good: 200, poor: 500, unit: 'ms', label: 'Response to a tap (INP)' },
  CLS: { good: 0.1, poor: 0.25, unit: '', label: 'Layout shift (CLS)' },
};

export function vital(name: string, p75: number): { label: string; value: string; rating: 'Good' | 'Needs work' | 'Poor'; tone: 'success' | 'warning' | 'danger' } {
  const spec = VITALS[name];
  if (!spec) return { label: name, value: String(p75), rating: 'Good', tone: 'success' };
  const value = spec.unit === 's' ? `${(p75 / 1000).toFixed(1)}s` : spec.unit === 'ms' ? `${Math.round(p75)}ms` : p75.toFixed(2);
  return p75 <= spec.good ? { label: spec.label, value, rating: 'Good', tone: 'success' } : p75 <= spec.poor ? { label: spec.label, value, rating: 'Needs work', tone: 'warning' } : { label: spec.label, value, rating: 'Poor', tone: 'danger' };
}

const DEVICE: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' };

export function shapeTraffic(t: Traffic) {
  const hourly = t.windowHours <= 48;
  return {
    windowHours: t.windowHours,
    recording: t.recording,
    empty: t.totals.sessions === 0,
    kpi: {
      sessions: count(t.totals.sessions),
      pageviews: count(t.totals.pageviews),
      guests: count(t.totals.guests),
      errors: count(t.totals.errors),
      duration: duration(t.totals.medianDurationSeconds),
    },
    delta: {
      sessions: delta(t.totals.sessions, t.previous.sessions),
      pageviews: delta(t.totals.pageviews, t.previous.pageviews),
      errors: delta(t.totals.errors, t.previous.errors, false),
    },
    points: t.series.map((p) => {
      const d = valid(p.at);
      return { label: d ? (hourly ? HOUR.format(d) : DAY.format(d)) : '', Sessions: p.sessions, 'Pages opened': p.pageviews, Errors: p.errors };
    }),
    pages: t.topPages.slice(0, 10).map((p) => ({ path: p.path, views: p.views, sessions: p.sessions, errors: p.errors })),
    devices: t.devices.map((d) => ({ device: DEVICE[d.device] ?? d.device, Sessions: d.sessions })),
    vitals: t.vitals.map((v) => ({ ...vital(v.name, v.p75), samples: v.samples })),
  };
}
export type TrafficView = ReturnType<typeof shapeTraffic>;

export const whoLabel = (s: SessionRow) => (s.who.kind === 'guest' ? (s.who.name ?? 'A guest') : s.who.kind === 'admin' ? 'An administrator' : 'Not signed in');

export function shapeSessions(list: SessionList) {
  return {
    total: list.total,
    shown: list.sessions.length,
    caption: list.total > list.sessions.length ? `Showing ${count(list.sessions.length)} of ${plural(list.total, 'session')}` : plural(list.total, 'session'),
    rows: list.sessions.slice(0, 50).map((s) => ({
      id: s.id,
      href: `/admin/sessions?id=${encodeURIComponent(s.id)}`,
      who: whoLabel(s),
      when: stamp(s.startedAt),
      duration: duration(s.durationSeconds),
      pages: s.pageviews,
      errors: s.errors,
      device: `${DEVICE[s.device] ?? s.device}, ${s.browser}`,
      path: s.entryPath === s.exitPath ? s.entryPath : `${s.entryPath} → ${s.exitPath}`,
    })),
  };
}
export type SessionsView = ReturnType<typeof shapeSessions>;

export function shapeSession(detail: SessionDetail) {
  const s = detail.session;
  return {
    id: s.id,
    who: whoLabel(s),
    when: stamp(s.startedAt),
    duration: duration(s.durationSeconds),
    device: `${DEVICE[s.device] ?? s.device}, ${s.browser}`,
    pages: s.pageviews,
    errors: s.errors,
    trail: detail.events
      .filter((e) => e.kind !== 'vital')
      .slice(0, 80)
      .map((e) => (e.kind === 'error' ? { time: clock(e.at), title: e.message ?? e.name ?? 'An error', description: `Error on ${e.path}`, marker: 'alert' } : { time: clock(e.at), title: e.path, description: 'Opened', marker: clock(e.at) })),
  };
}
export type SessionView = ReturnType<typeof shapeSession>;

export function shapeErrors(e: ErrorGroups) {
  return {
    windowHours: e.windowHours,
    total: e.total,
    groups: e.groups.length,
    kpi: { total: count(e.total), groups: count(e.groups.length), sessions: count(e.groups.reduce((n, g) => Math.max(n, g.sessions), 0)) },
    rows: e.groups.slice(0, 25).map((g) => ({
      message: g.message.length > 110 ? `${g.message.slice(0, 109)}…` : g.message,
      where: g.paths.slice(0, 3).join(', ') || g.sample.path,
      source: g.source === 'server' ? 'Server' : 'Browser',
      count: g.count,
      sessions: g.sessions,
      last: stamp(g.lastAt),
      href: g.sample.sessionId ? `/admin/sessions?id=${encodeURIComponent(g.sample.sessionId)}` : '/admin/errors',
    })),
  };
}
export type ErrorsView = ReturnType<typeof shapeErrors>;

const safeState = (s: string) => stateLabel(s as LifecycleState) ?? s;

export function shapeLifecycle(l: Lifecycle) {
  const at = l.states.indexOf(l.state);
  return {
    state: l.state,
    stateLabel: safeState(l.state),
    suggested: l.suggested,
    suggestedLabel: safeState(l.suggested),
    behind: l.behindSchedule,
    published: stamp(l.publishedAt),
    steps: l.states.map((s, i) => ({ state: s, label: safeState(s), marker: i < at ? 'done' : i === at ? 'alert' : 'todo', note: i === at ? 'Guests see this now' : s === l.suggested && l.behindSchedule ? 'The calendar suggests this' : '' })),
  };
}
export type LifecycleView = ReturnType<typeof shapeLifecycle>;

const JOB_STATUS: Record<string, string> = { queued: 'Queued', running: 'Running', succeeded: 'Done', failed: 'Failed, will retry', dead: 'Stuck', cancelled: 'Cancelled' };

export function shapeJobs(j: Jobs) {
  const dead = j.byStatus.dead ?? 0;
  return {
    dead,
    due: j.dueNow,
    kpi: { dead: count(dead), due: count(j.dueNow) },
    waiting: j.oldestDueAgeSeconds == null ? 'Nothing waiting' : `Oldest waiting ${duration(j.oldestDueAgeSeconds)}`,
    counts: Object.entries(j.byStatus)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => ({ status: JOB_STATUS[status] ?? status, Jobs: n })),
    attention: j.attention.slice(0, 10).map((r) => ({ id: r.id, type: r.type, status: JOB_STATUS[r.status] ?? r.status, attempts: `${r.attempts} of ${r.maxAttempts}`, error: r.lastError ? (r.lastError.length > 120 ? `${r.lastError.slice(0, 119)}…` : r.lastError) : '—', when: stamp(r.updatedAt), dead: r.status === 'dead' })),
    types: j.byType.slice(0, 12).map((t) => ({ type: t.type, total: t.total, queued: t.queued, dead: t.dead })),
  };
}
export type JobsView = ReturnType<typeof shapeJobs>;

export function shapeRsvp(r: Rsvp) {
  const byGuest = new Map<string, { name: string; household: string; events: string[] }>();
  const replied = new Set<string>();
  const invited = new Set<string>();
  for (const row of r.rows) {
    invited.add(row.guestId);
    if (row.status) replied.add(row.guestId);
    else {
      const g = byGuest.get(row.guestId) ?? { name: row.displayName, household: row.householdName, events: [] };
      g.events.push(row.eventName);
      byGuest.set(row.guestId, g);
    }
  }
  const pending = [...byGuest.values()];
  return {
    open: r.window.open,
    deadline: r.window.deadlineAt ? stamp(r.window.deadlineAt) : '',
    invited: invited.size,
    replied: replied.size,
    waiting: pending.length,
    percent: invited.size ? Math.round((replied.size / invited.size) * 100) : 0,
    kpi: { replied: count(replied.size), waiting: count(pending.length), invited: count(invited.size), percent: `${invited.size ? Math.round((replied.size / invited.size) * 100) : 0}%` },
    bars: r.events.map((e) => ({ event: e.name, Coming: e.accepted, 'Not coming': e.declined, 'No answer yet': e.pending })),
    events: r.events.map((e) => ({ event: e.name, invited: e.invited, coming: e.accepted, declined: e.declined, pending: e.pending, plusOnes: e.plusOnes })),
    pending: pending.slice(0, 60).map((g) => ({ name: g.name, household: g.household, events: g.events.join(', ') })),
    pendingMore: Math.max(0, pending.length - 60),
  };
}
export type RsvpView = ReturnType<typeof shapeRsvp>;

const METRIC: Record<string, string> = {
  'capability.duration_ms': 'Any action on the site',
  'capability.invocations': 'Actions run',
  'ai.answer_ms': 'Concierge answer',
  'ai.answers': 'Concierge answers',
  'auth.sign_in': 'Sign-ins',
  'job.duration_ms': 'Background job',
  'job.failures': 'Job failures',
};
const ms = (n: number | null) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

export function shapeMetrics(m: Metrics) {
  const timings = m.series.filter((s) => s.kind === 'histogram').sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  const counters = m.series.filter((s) => s.kind === 'counter').sort((a, b) => b.sum - a.sum);
  return {
    windowHours: m.windowHours,
    recording: m.recording,
    points: m.totalPoints,
    denied: m.audit.byOutcome.denied ?? 0,
    failed: m.audit.byOutcome.failed ?? 0,
    actions: m.audit.total,
    kpi: { actions: count(m.audit.total), denied: count(m.audit.byOutcome.denied ?? 0), failed: count(m.audit.byOutcome.failed ?? 0) },
    timings: timings.map((s) => ({ name: METRIC[s.name] ?? s.name, samples: s.points, p50: ms(s.p50), p95: ms(s.p95), max: ms(s.max) })),
    counters: counters.map((s) => ({ name: METRIC[s.name] ?? s.name, Total: Math.round(s.sum) })),
    slowest: timings[0] ? { name: METRIC[timings[0].name] ?? timings[0].name, p95: ms(timings[0].p95) } : null,
  };
}
export type MetricsView = ReturnType<typeof shapeMetrics>;

const ACTOR: Record<string, string> = { admin: 'An administrator', guest: 'A guest', system: 'The site', anonymous: 'Not signed in' };
const OUTCOME: Record<string, string> = { success: 'Done', denied: 'Refused', failed: 'Failed' };
const words = (s: string) => s.replace(/[._]/g, ' ');

export function shapeAudit(a: Audit) {
  return {
    total: a.window.total,
    denied: a.window.byOutcome.denied ?? 0,
    failed: a.window.byOutcome.failed ?? 0,
    kpi: { total: count(a.window.total), denied: count(a.window.byOutcome.denied ?? 0), failed: count(a.window.byOutcome.failed ?? 0) },
    rows: a.rows.slice(0, 25).map((r) => ({ when: stamp(r.at), who: ACTOR[r.actor.kind] ?? r.actor.kind, action: words(r.action), target: r.targetType === 'capability' ? words(r.targetId) : words(r.targetType), outcome: OUTCOME[r.outcome] ?? r.outcome, tone: r.outcome === 'success' ? 'neutral' : r.outcome === 'denied' ? 'warning' : 'danger' })),
  };
}
export type AuditView = ReturnType<typeof shapeAudit>;

/** Shape a tool's result by name; anything unknown passes through untouched. */
export function shapeTool(name: ReadTool | string, data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;
  switch (name) {
    case 'admin_site_traffic':
      return shapeTraffic(data as Traffic);
    case 'admin_list_sessions':
      return shapeSessions(data as SessionList);
    case 'admin_session_detail':
      return shapeSession(data as SessionDetail);
    case 'admin_site_errors':
      return shapeErrors(data as ErrorGroups);
    case 'admin_lifecycle_status':
      return shapeLifecycle(data as Lifecycle);
    case 'admin_jobs_overview':
      return shapeJobs(data as Jobs);
    case 'admin_rsvp_overview':
      return shapeRsvp(data as Rsvp);
    case 'admin_ops_metrics':
      return shapeMetrics(data as Metrics);
    case 'admin_search_audit':
      return shapeAudit(data as Audit);
    default:
      return data;
  }
}

/** Query arguments arrive from `$variables` as text ("168"); the capabilities want numbers. */
export function toolArgs(args: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    out[key] = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value;
  }
  return out;
}
