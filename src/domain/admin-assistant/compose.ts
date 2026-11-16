import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { stateLabel } from '@/domain/lifecycle/words';
import { VIEWS, WINDOWS, windowWords, type ViewName } from './catalog';
import { plural, shapeAudit, shapeErrors, shapeJobs, shapeLifecycle, shapeMetrics, shapeRsvp, shapeSession, shapeSessions, shapeTraffic, stamp, whoLabel } from './shape';
import type { Answer, Gathered, Intent } from './types';

/**
 * An answer as an OpenUI Lang program for the console's library (components/admin/assistant/openui).
 *
 * Every number in a program comes from a record that was read for this administrator: either a
 * literal written here from `Gathered`, or a `Query(...)` whose default is that same data and whose
 * refresh goes back through the capability route. Nothing here is generated text about the site —
 * the words are fixed sentences with the figures placed in them.
 */

/** A string literal: OpenUI Lang reads double-quoted strings as JSON, so JSON's escaping is exact. */
const s = (value: unknown) => JSON.stringify(value == null ? '' : String(value));
/** A data literal. */
const j = (value: unknown) => JSON.stringify(value ?? null);

export type Screen = { href: string; label: string; blurb: string; words?: string };

type Program = { root: string[]; lines: string[] };
const program = (): Program => ({ root: [], lines: [] });
const add = (p: Program, name: string, expr: string, inRoot = true) => {
  p.lines.push(`${name} = ${expr}`);
  if (inRoot) p.root.push(name);
};
const finish = (p: Program, next: string[]) => {
  const asks = next.filter(Boolean).slice(0, 3);
  if (asks.length) add(p, 'next', `Row([${asks.map((q) => `Button(${s(q)}, null, "ghost", null, "sm")`).join(', ')}], 2, null, null, true)`);
  return [`root = Col([${p.root.join(', ')}], 5)`, ...p.lines].join('\n');
};

const WINDOW_OPTIONS = `[${WINDOWS.map((w) => `{value: "${w.hours}", label: "${w.label}"}`).join(', ')}]`;
const windowOf = (intent: Intent, fallback = 168) => (WINDOWS.some((w) => w.hours === intent.window) ? intent.window! : fallback);
/**
 * The page prints an answer's title and summary itself (so the summary can be reworded on the
 * device without touching the program); what a program opens with is its one control, when it has
 * one: the time window its queries read.
 */
const head = (p: Program, _title: string, _summary: string, control = false) => {
  if (control) add(p, 'range', `Row([Label("Window"), SegmentedControl($window, ${WINDOW_OPTIONS})], 3)`);
};
const kpi = (label: string, value: string, extra = '') => `Card([Caption(${s(label)}), Row([Title(${value}, "xl")${extra ? `, ${extra}` : ''}], 2, "end", null, true)])`;
const deltaBadge = (ref: string) => `${ref} == null ? null : Badge(${ref}.text, ${ref}.tone)`;
const grid = (cells: string[]) => `Grid([${cells.join(', ')}], null, 150, 0)`;

const noAccess = (view: ViewName, what: string): Answer => {
  const p = program();
  head(p, 'Not part of your access', `${what} is not part of your administrator role. The owner can grant it.`);
  return { view, title: 'Not part of your access', summary: `${what} is not part of your administrator role.`, program: finish(p, ['What needs my attention?']), facts: [], next: ['What needs my attention?'] };
};

const label = (state: string) => stateLabel(state as LifecycleState) ?? state;

/* ---- Visits -------------------------------------------------------------------------------- */

function traffic(g: Gathered, intent: Intent): Answer {
  if (!g.traffic) return noAccess('traffic', 'Visits');
  const hours = windowOf(intent);
  const v = shapeTraffic(g.traffic);
  const t = g.traffic.totals;
  const top = g.traffic.topPages[0];
  const summary = !g.traffic.recording
    ? 'Visits are not being recorded on this deployment.'
    : t.sessions === 0
      ? `No visits were recorded in ${windowWords(hours)}.`
      : `${plural(t.sessions, 'session')} and ${plural(t.pageviews, 'page')} opened in ${windowWords(hours)}; ${plural(t.guests, 'guest')} signed in.${top ? ` The busiest page was ${top.path}.` : ''}`;
  const p = program();
  p.lines.push(`$window = "${hours}"`, `t = Query("admin_site_traffic", {windowHours: $window}, ${j(v)}, 60)`);
  head(p, 'Visits', summary, true);
  add(p, 'kpis', grid([kpi('Sessions', 't.kpi.sessions', deltaBadge('t.delta.sessions')), kpi('Pages opened', 't.kpi.pageviews', deltaBadge('t.delta.pageviews')), kpi('Guests signed in', 't.kpi.guests'), kpi('Typical visit', 't.kpi.duration')]));
  add(p, 'trend', `t.empty ? Text("Nothing to chart for this window.", "md", "muted") : Card([Title("Sessions and pages opened", "sm"), Chart("area", t.points, "label", ["Sessions", "Pages opened"])])`);
  add(p, 'pages', `Card([Title("Busiest pages", "sm"), Table(["Page", "Views", "Sessions", "Errors"], @Each(t.pages, "p", [p.path, p.views, p.sessions, p.errors]))])`, false);
  add(p, 'devices', `Card([Title("Devices", "sm"), Chart("bar", t.devices, "device", ["Sessions"], null, null, null, 160)])`, false);
  add(p, 'speed', `Card([Title("Page speed, 75th percentile", "sm"), Table(["Measure", "Value", "Rating", "Samples"], @Each(t.vitals, "v", [v.label, v.value, Badge(v.rating, v.tone), v.samples]))])`, false);
  add(p, 'lower', `Grid([pages, Col([devices, speed], 4)], 2, 320, 4)`);
  const next = ['Who visited?', t.errors ? 'What errors did guests hit?' : 'How many guests have replied?'];
  return {
    view: 'traffic',
    title: 'Visits',
    summary,
    program: finish(p, next),
    facts: [`Window: ${windowWords(hours)}`, `Sessions: ${t.sessions}`, `Pages opened: ${t.pageviews}`, `Guests signed in: ${t.guests}`, `Errors: ${t.errors}`, ...(top ? [`Busiest page: ${top.path} with ${top.views} views`] : []), ...v.vitals.map((x) => `${x.label}: ${x.value}, ${x.rating}`)],
    next,
  };
}

/* ---- Sessions ------------------------------------------------------------------------------ */

function sessions(g: Gathered, intent: Intent): Answer {
  if (!g.sessions) return noAccess('sessions', 'Sessions');
  const hours = windowOf(intent);
  const v = shapeSessions(g.sessions);
  const who = intent.withErrors ? 'Sessions that hit an error' : 'Sessions';
  const summary = g.sessions.total === 0 ? `No ${intent.withErrors ? 'sessions hit an error' : 'sessions were recorded'} in ${windowWords(hours)}.` : `${plural(g.sessions.total, 'session')} in ${windowWords(hours)}${intent.withErrors ? ', each with at least one error' : ''}. Open one to see it page by page.`;
  const args = ['windowHours: $window', ...(intent.withErrors ? ['withErrors: true'] : [])].join(', ');
  const p = program();
  p.lines.push(`$window = "${hours}"`, `l = Query("admin_list_sessions", {${args}}, ${j(v)}, 60)`);
  head(p, who, summary, true);
  add(p, 'rows', `Col([Caption(l.caption), Table(["Who", "Started", "Time on site", "Pages", "Errors", "Device", "Came in and left"], @Each(l.rows, "r", [Link(r.who, r.href), r.when, r.duration, r.pages, r.errors, r.device, r.path]))], 2)`);
  const next = [intent.withErrors ? 'What errors did guests hit?' : 'Which sessions hit an error?', 'How many visits this week?'];
  const first = g.sessions.sessions[0];
  return {
    view: 'sessions',
    title: who,
    summary,
    program: finish(p, next),
    facts: [`Window: ${windowWords(hours)}`, `Sessions: ${g.sessions.total}`, ...(first ? [`Most recent: ${whoLabel(first)}, ${stamp(first.startedAt)}, ${first.pageviews} pages`] : [])],
    next,
  };
}

function session(g: Gathered): Answer {
  const p = program();
  if (!g.session) {
    head(p, 'That session is not on record', 'It may be older than the retention period, or the address was mistyped.');
    const next = ['Who visited this week?'];
    return { view: 'session', title: 'Session not found', summary: 'That session is not on record.', program: finish(p, next), facts: [], next };
  }
  const v = shapeSession(g.session);
  const summary = `${v.who}, ${v.when}: ${plural(v.pages, 'page')} in ${v.duration} (${v.device})${v.errors ? `, with ${plural(v.errors, 'error')}` : ''}.`;
  p.lines.push(`d = Query("admin_session_detail", {sessionId: ${s(v.id)}}, ${j(v)})`);
  head(p, v.who, summary);
  add(p, 'trail', `Card([Title("Page by page", "sm"), List(@Each(d.trail, "e", ListItem(e.title, e.description, e.marker)), "none", true)])`);
  const next = ['Who else visited?', v.errors ? 'What errors did guests hit?' : ''];
  return { view: 'session', title: `${v.who}, ${v.when}`, summary, program: finish(p, next), facts: [`Visitor: ${v.who}`, `Started: ${v.when}`, `Pages: ${v.pages}`, `Errors: ${v.errors}`, `Time on site: ${v.duration}`], next };
}

/* ---- Errors -------------------------------------------------------------------------------- */

function errors(g: Gathered, intent: Intent): Answer {
  if (!g.errors) return noAccess('errors', 'Errors');
  const hours = windowOf(intent);
  const v = shapeErrors(g.errors);
  const worst = g.errors.groups[0];
  const summary =
    g.errors.total === 0
      ? `No errors were recorded in ${windowWords(hours)}.`
      : `${plural(g.errors.total, 'error')} in ${windowWords(hours)}, from ${plural(g.errors.groups.length, 'different problem')}.${worst ? ` The most frequent, seen ${plural(worst.count, 'time')}, was on ${worst.paths[0] ?? worst.sample.path}.` : ''}`;
  const p = program();
  p.lines.push(`$window = "${hours}"`, `e = Query("admin_site_errors", {windowHours: $window}, ${j(v)}, 60)`);
  if (g.traffic) p.lines.push(`t = Query("admin_site_traffic", {windowHours: $window}, ${j(shapeTraffic(g.traffic))}, 60)`);
  head(p, 'Errors', summary, true);
  add(p, 'kpis', grid([kpi('Errors', 'e.kpi.total', g.traffic ? deltaBadge('t.delta.errors') : ''), kpi('Different problems', 'e.kpi.groups'), kpi('Sessions on the worst', 'e.kpi.sessions')]));
  if (g.traffic) add(p, 'trend', `e.total == 0 ? null : Card([Title("Errors over time", "sm"), Chart("bar", t.points, "label", ["Errors"], null, null, null, 180)])`);
  add(p, 'groups', `Card([Title("Problems, most frequent first", "sm"), Table(["Problem", "Where", "Seen", "Sessions", "Last seen", "From"], @Each(e.rows, "x", [Link(x.message, x.href), x.where, x.count, x.sessions, x.last, x.source]))])`);
  const next = ['Which sessions hit an error?', 'How many visits this week?'];
  return {
    view: 'errors',
    title: 'Errors',
    summary,
    program: finish(p, next),
    facts: [`Window: ${windowWords(hours)}`, `Errors: ${g.errors.total}`, `Different problems: ${g.errors.groups.length}`, ...g.errors.groups.slice(0, 3).map((x) => `"${x.message.slice(0, 80)}" seen ${x.count} times on ${x.paths[0] ?? x.sample.path}`)],
    next,
  };
}

/* ---- Replies ------------------------------------------------------------------------------- */

function rsvp(g: Gathered, pendingOnly: boolean): Answer {
  if (!g.rsvp) return noAccess(pendingOnly ? 'pending' : 'rsvp', 'Replies');
  const v = shapeRsvp(g.rsvp);
  const p = program();
  p.lines.push(`r = Query("admin_rsvp_overview", {}, ${j(v)}, 120)`);
  const facts = [`Invited: ${v.invited}`, `Replied: ${v.replied}`, `No answer yet: ${v.waiting}`, ...v.events.map((e) => `${e.event}: ${e.coming} coming, ${e.declined} not coming, ${e.pending} no answer yet`)];
  if (pendingOnly) {
    const summary = v.invited === 0 ? 'Nobody is invited to an event yet.' : v.waiting === 0 ? 'Everyone invited has replied.' : `${plural(v.waiting, 'guest')} of ${v.invited} ${v.waiting === 1 ? 'has' : 'have'} not replied to at least one event.`;
    head(p, 'No answer yet', summary);
    add(p, 'rows', `Col([Table(["Guest", "Household", "Not answered for"], @Each(r.pending, "x", [x.name, x.household, x.events])), r.pendingMore > 0 ? Caption("The list is longer than fits here.") : null, Link("Open RSVPs to export the full list", "/admin/rsvp")], 2)`);
    const next = ['How many guests have replied?', 'What needs my attention?'];
    return { view: 'pending', title: 'No answer yet', summary, program: finish(p, next), facts, next };
  }
  const summary = v.invited === 0 ? 'Nobody is invited to an event yet.' : `${v.replied} of ${plural(v.invited, 'invited guest')} ${v.replied === 1 ? 'has' : 'have'} replied (${v.percent}%). ${v.open ? 'Replies are open.' : 'Replies are closed to guests right now.'}`;
  head(p, 'Replies', summary);
  add(p, 'kpis', grid([kpi('Replied', 'r.kpi.replied', 'Badge(r.kpi.percent, "neutral")'), kpi('No answer yet', 'r.kpi.waiting'), kpi('Invited', 'r.kpi.invited')]));
  add(p, 'byEvent', `Card([Title("By event", "sm"), Chart("bar", r.bars, "event", ["Coming", "Not coming", "No answer yet"], null, null, true), Table(["Event", "Invited", "Coming", "Not coming", "No answer yet", "Plus-ones"], @Each(r.events, "e", [e.event, e.invited, e.coming, e.declined, e.pending, e.plusOnes]))])`);
  add(p, 'links', `Row([Link("Open RSVPs", "/admin/rsvp")], 3)`);
  const next = [v.waiting ? 'Who has not replied?' : '', 'What needs my attention?'];
  return { view: 'rsvp', title: 'Replies', summary, program: finish(p, next), facts, next };
}

/* ---- One guest ----------------------------------------------------------------------------- */

function guest(g: Gathered, intent: Intent): Answer {
  const p = program();
  const asked = intent.subject?.trim() ?? '';
  if (g.guests === null) return noAccess('guest', 'The guest list');
  const found = (g.guests ?? []).slice(0, 5);
  if (!found.length) {
    const summary = asked ? `No guest matches “${asked}”.` : 'Name the guest to look up.';
    head(p, 'Guest not found', summary);
    add(p, 'links', `Row([Link("Search the guest list", "/admin/guests")], 3)`);
    const next = ['Who visited this week?'];
    return { view: 'guest', title: 'Guest not found', summary, program: finish(p, next), facts: [], next };
  }
  const one = found.length === 1 ? found[0]! : null;
  const replies = (id: string) => (g.rsvp?.rows ?? []).filter((r) => r.guestId === id);
  const answer = (status: string | null) => (status === 'attending' || status === 'accepted' ? 'Coming' : status === 'declined' ? 'Not coming' : status ? status : 'No answer yet');
  const visits = one ? (g.sessions?.sessions ?? []) : [];
  const summary = one
    ? `${one.displayName}, ${one.householdName}. ${one.claimed ? `Signed in since ${stamp(one.claimedAt)}` : 'Has not signed in yet'}${g.sessions ? `; ${plural(g.sessions.total, 'visit')} in the last 30 days` : ''}.`
    : `${found.length} guests match “${asked}”.`;
  head(p, one ? one.displayName : 'Guests', summary);
  found.forEach((x, i) => {
    const rows = replies(x.id);
    const cells = [`Row([Title(${s(x.displayName)}, "sm"), Badge(${s(x.claimed ? 'Signed in' : 'Not signed in yet')}, ${x.claimed ? '"success"' : '"neutral"'})], 2, null, null, true)`, `Text(${s([x.householdName, x.isMinor ? 'a minor' : x.kind.replace(/_/g, ' '), x.email ? 'has an email' : 'no email'].join(' · '))}, "sm", "muted")`];
    if (rows.length) cells.push(`Table(["Event", "Reply"], ${j(rows.map((r) => [r.eventName, answer(r.status)]))})`);
    cells.push(`Row([Link("Open in Guests", ${s(`/admin/guests?q=${encodeURIComponent(x.displayName)}`)})${one ? '' : `, Button(${s(`What has ${x.displayName} done on the site?`)}, null, "ghost", null, "sm")`}], 3, null, null, true)`);
    add(p, `g${i}`, `Card([${cells.join(', ')}])`);
  });
  if (one && g.sessions) {
    const v = shapeSessions(g.sessions);
    add(p, 'visits', `Card([Title("Visits, last 30 days", "sm"), Table(["Started", "Time on site", "Pages", "Errors", "Device", "Came in and left"], @Each(${j(v.rows)}, "r", [Link(r.when, r.href), r.duration, r.pages, r.errors, r.device, r.path]))])`);
  }
  const next = ['Who has not replied?', 'Who visited this week?'];
  return {
    view: 'guest',
    title: one ? one.displayName : 'Guests',
    summary,
    program: finish(p, next),
    facts: one ? [`Guest: ${one.displayName}`, `Household: ${one.householdName}`, `Signed in: ${one.claimed ? 'yes' : 'no'}`, `Visits in the last 30 days: ${visits.length}`, ...replies(one.id).map((r) => `${r.eventName}: ${answer(r.status)}`)] : found.map((x) => `Match: ${x.displayName}, ${x.householdName}`),
    next,
  };
}

/* ---- Lifecycle ----------------------------------------------------------------------------- */

const publishProposal = (from: string, to: string) =>
  `Proposal(${s(`Publish ${label(to)}`)}, ${s(`Every guest sees ${label(to)} instead of ${label(from)}: the navigation and the home page change for everyone at once. Review shows exactly what changes.`)}, "admin_publish_lifecycle", {to: ${s(to)}}, ${s(`Publish ${label(to)}`)}, false, "draft_lifecycle_transition")`;

function lifecycle(g: Gathered, intent: Intent): Answer {
  if (!g.lifecycle) return noAccess('lifecycle', 'The lifecycle');
  const l = g.lifecycle;
  const v = shapeLifecycle(l);
  const wanted = intent.state && (LIFECYCLE_STATES as readonly string[]).includes(intent.state) ? intent.state : null;
  const target = wanted && wanted !== l.state ? wanted : !wanted && l.behindSchedule ? l.suggested : null;
  const summary =
    wanted === l.state
      ? `The site is already at ${v.stateLabel}.`
      : `Guests see ${v.stateLabel} now${l.publishedAt ? `, published ${v.published}` : ''}. ${l.behindSchedule ? `The calendar suggests ${v.suggestedLabel}; nothing changes until someone publishes it.` : 'That matches the calendar.'}`;
  const p = program();
  p.lines.push(`l = Query("admin_lifecycle_status", {historyLimit: 1}, ${j(v)}, 120)`);
  head(p, 'Lifecycle', summary);
  if (target) add(p, 'change', publishProposal(l.state, target));
  add(p, 'steps', `Card([Title("Where the site is", "sm"), List(@Each(l.steps, "x", ListItem(x.label, x.note, x.marker)), "none")])`);
  add(p, 'links', `Row([Link("Open Lifecycle to preview a state", "/admin/lifecycle")], 3)`);
  const next = ['What needs my attention?', 'How many guests have replied?'];
  return { view: 'lifecycle', title: 'Lifecycle', summary, program: finish(p, next), facts: [`Current state: ${v.stateLabel}`, `Calendar suggests: ${v.suggestedLabel}`, `Behind the calendar: ${l.behindSchedule ? 'yes' : 'no'}`, ...(target ? [`Proposed: publish ${label(target)}`] : [])], next };
}

/* ---- Jobs ---------------------------------------------------------------------------------- */

function jobs(g: Gathered): Answer {
  if (!g.jobs) return noAccess('jobs', 'Background jobs');
  const v = shapeJobs(g.jobs);
  const stuck = v.attention.filter((r) => r.dead);
  const summary = v.dead ? `${plural(v.dead, 'job')} ${v.dead === 1 ? 'is' : 'are'} stuck and will not run again without a retry. ${plural(v.due, 'job')} due now.` : `Nothing is stuck. ${v.due ? `${plural(v.due, 'job')} due now.` : 'The queue is empty.'}`;
  const p = program();
  p.lines.push(`q = Query("admin_jobs_overview", {attentionLimit: 10, recentLimit: 1}, ${j(v)}, 30)`);
  head(p, 'Background jobs', summary);
  add(p, 'kpis', grid([kpi('Stuck', 'q.kpi.dead'), kpi('Due now', 'q.kpi.due'), `Card([Caption("Queue"), Text(q.waiting, "md")])`]));
  stuck.slice(0, 3).forEach((r, i) => add(p, `retry${i}`, `Proposal(${s(`Retry ${r.type}`)}, ${s(`Puts this job back in the queue to run once more. It stopped after ${r.attempts} attempts: ${r.error}`)}, "admin_retry_job", {jobId: ${s(r.id)}}, ${s(`Retry ${r.type}`)})`));
  add(p, 'attention', `Card([Title("Needs a look", "sm"), Table(["Job", "State", "Attempts", "Last error", "Updated"], @Each(q.attention, "x", [x.type, x.status, x.attempts, x.error, x.when]))])`);
  add(p, 'links', `Row([Link("Open Jobs", "/admin/jobs")], 3)`);
  const next = ['What needs my attention?', 'What errors did guests hit?'];
  return { view: 'jobs', title: 'Background jobs', summary, program: finish(p, next), facts: [`Stuck jobs: ${v.dead}`, `Due now: ${v.due}`, ...stuck.slice(0, 3).map((r) => `Stuck: ${r.type}, ${r.attempts} attempts`)], next };
}

/* ---- Metrics ------------------------------------------------------------------------------- */

function metrics(g: Gathered, intent: Intent): Answer {
  if (!g.metrics) return noAccess('metrics', 'Metrics');
  const hours = windowOf(intent, 24);
  const v = shapeMetrics(g.metrics);
  const summary = !v.recording
    ? 'This deployment is not recording metrics, so there are no timings to show. The audit counts below are still real.'
    : v.slowest
      ? `The slowest thing measured in ${windowWords(hours)} was “${v.slowest.name}”: 95 in 100 finished within ${v.slowest.p95}. ${plural(v.denied, 'action')} refused, ${v.failed} failed.`
      : `Nothing was timed in ${windowWords(hours)}. ${plural(v.actions, 'action')} audited.`;
  const p = program();
  p.lines.push(`$window = "${hours}"`, `m = Query("admin_ops_metrics", {windowHours: $window}, ${j(v)}, 60)`);
  head(p, 'Metrics', summary, true);
  add(p, 'kpis', grid([kpi('Actions audited', 'm.kpi.actions'), kpi('Refused', 'm.kpi.denied'), kpi('Failed', 'm.kpi.failed')]));
  add(p, 'timings', `Card([Title("How long things take", "sm"), Table(["What", "Samples", "Typical", "95 in 100 within", "Slowest"], @Each(m.timings, "x", [x.name, x.samples, x.p50, x.p95, x.max]))])`);
  add(p, 'counts', `@Count(m.counters) == 0 ? null : Card([Title("Counts", "sm"), Chart("bar", m.counters, "name", ["Total"], null, null, null, 200)])`);
  add(p, 'links', `Row([Link("Open Metrics", "/admin/metrics"), Link("Audit trail", "/admin/audit")], 3)`);
  const next = ['What was refused?', 'What errors did guests hit?'];
  return { view: 'metrics', title: 'Metrics', summary, program: finish(p, next), facts: [`Window: ${windowWords(hours)}`, `Recording: ${v.recording ? 'yes' : 'no'}`, `Actions audited: ${v.actions}`, `Refused: ${v.denied}`, `Failed: ${v.failed}`, ...v.timings.slice(0, 3).map((x) => `${x.name}: typical ${x.p50}, 95 in 100 within ${x.p95}`)], next };
}

/* ---- Audit --------------------------------------------------------------------------------- */

function activity(g: Gathered, intent: Intent): Answer {
  if (!g.audit) return noAccess('activity', 'The audit trail');
  const v = shapeAudit(g.audit);
  const summary = intent.denied ? (v.rows.length ? `The ${v.rows.length} most recent refused actions. A refusal is the site saying no to someone without the access for it.` : 'Nothing has been refused.') : `The ${v.rows.length} most recent actions of ${v.kpi.total} on record; ${v.denied} refused, ${v.failed} failed.`;
  const p = program();
  p.lines.push(`a = Query("admin_search_audit", {limit: 25${intent.denied ? ', outcome: "denied"' : ''}}, ${j(v)}, 60)`);
  head(p, intent.denied ? 'Refused actions' : 'Recent activity', summary);
  add(p, 'rows', `Table(["When", "Who", "Action", "On", "Outcome"], @Each(a.rows, "x", [x.when, x.who, x.action, x.target, Badge(x.outcome, x.tone)]))`);
  add(p, 'links', `Row([Link("Search the audit trail", "/admin/audit")], 3)`);
  const next = [intent.denied ? 'What changed recently?' : 'What was refused?', 'What needs my attention?'];
  return { view: 'activity', title: intent.denied ? 'Refused actions' : 'Recent activity', summary, program: finish(p, next), facts: [`Actions on record: ${v.total}`, `Refused: ${v.denied}`, `Failed: ${v.failed}`], next };
}

/* ---- What needs you ------------------------------------------------------------------------ */

export type AttentionItem = {
  state: 'alert' | 'todo' | 'done';
  title: string;
  detail: string;
  /** What to do about it: a question that opens the detail, or a lifecycle state to publish. */
  act?: { ask: string } | { publish: { from: string; to: string } };
  /** The console screen it belongs to. */
  href: string;
};

/** The checklist: what is waiting on a person, most urgent first, then what is fine. */
export function attentionItems(g: Gathered): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (g.lifecycle?.behindSchedule) {
    items.push({ state: 'alert', title: `The calendar has moved on to ${label(g.lifecycle.suggested)}`, detail: `Guests still see ${label(g.lifecycle.state)}. Nothing changes until someone publishes it.`, act: { publish: { from: g.lifecycle.state, to: g.lifecycle.suggested } }, href: '/admin/lifecycle' });
  }
  const dead = g.jobs?.byStatus.dead ?? 0;
  if (dead) items.push({ state: 'alert', title: `${plural(dead, 'background job')} stuck`, detail: 'They stopped retrying. Whatever they were sending or processing has not happened.', act: { ask: 'Are any jobs stuck?' }, href: '/admin/jobs' });
  if (g.errors?.total) {
    const worst = g.errors.groups[0];
    items.push({ state: 'alert', title: `${plural(g.errors.total, 'error')} hit visitors this week`, detail: worst ? `Most often on ${worst.paths[0] ?? worst.sample.path}: ${worst.message.slice(0, 90)}` : 'See which pages they happened on.', act: { ask: 'What errors did guests hit?' }, href: '/admin/errors' });
  }
  if (g.rsvp) {
    const v = shapeRsvp(g.rsvp);
    if (g.rsvp.window.open && v.waiting) items.push({ state: 'todo', title: `${plural(v.waiting, 'guest')} ${v.waiting === 1 ? 'has' : 'have'} not replied`, detail: `${v.replied} of ${v.invited} invited have answered${v.deadline ? `; replies close ${v.deadline}` : ''}.`, act: { ask: 'Who has not replied?' }, href: '/admin/rsvp' });
    else if (v.invited && !v.waiting) items.push({ state: 'done', title: 'Everyone invited has replied', detail: `${v.invited} of ${v.invited}.`, href: '/admin/rsvp' });
  }
  if (g.jobs && !dead) items.push({ state: 'done', title: 'No background job is stuck', detail: g.jobs.dueNow ? `${plural(g.jobs.dueNow, 'job')} due now.` : 'The queue is empty.', href: '/admin/jobs' });
  if (g.errors && !g.errors.total) items.push({ state: 'done', title: 'No errors this week', detail: 'Nothing broke for a visitor in the last 7 days.', href: '/admin/errors' });
  if (g.lifecycle && !g.lifecycle.behindSchedule) items.push({ state: 'done', title: 'The site matches the calendar', detail: `Guests see ${label(g.lifecycle.state)}.`, href: '/admin/lifecycle' });
  return items;
}

function attention(g: Gathered): Answer {
  const items = attentionItems(g);
  const open = items.filter((i) => i.state !== 'done');
  const summary = open.length ? `${plural(open.length, 'thing')} ${open.length === 1 ? 'needs' : 'need'} you. The first is the one to do now.` : 'Nothing is waiting on you.';
  const p = program();
  head(p, 'What needs you', summary);
  const names = items.map((item, i) => {
    const control = !item.act ? '' : 'ask' in item.act ? `Button(${s(item.act.ask)}, null, "outline", null, "sm")` : publishProposal(item.act.publish.from, item.act.publish.to);
    add(p, `i${i}`, `ListItem(${s(item.title)}, ${s(item.detail)}, "${item.state}"${control ? `, [${control}]` : ''})`, false);
    return `i${i}`;
  });
  add(p, 'list', names.length ? `List([${names.join(', ')}], "none")` : `Text("There is nothing on record to check yet.", "md", "muted")`);
  const next = ['How many guests have replied?', 'Who visited this week?'];
  return { view: 'attention', title: 'What needs you', summary, program: finish(p, next), facts: items.map((i) => `${i.state === 'done' ? 'Fine' : 'Needs a person'}: ${i.title}. ${i.detail}`), next };
}

/* ---- Where something is edited ------------------------------------------------------------- */

export function matchScreens(subject: string, screens: readonly Screen[]): Screen[] {
  const tokens = subject.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return [];
  return screens
    .map((screen) => {
      const hay = `${screen.label} ${screen.words ?? ''} ${screen.blurb}`.toLowerCase();
      const name = screen.label.toLowerCase();
      return { screen, score: tokens.reduce((n, t) => n + (name.includes(t) ? 3 : hay.includes(t) ? 1 : 0), 0) };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((m) => m.screen);
}

function open(intent: Intent, screens: readonly Screen[]): Answer {
  const found = matchScreens(intent.subject ?? '', screens);
  const p = program();
  if (!found.length) return help(`I could not tell which screen “${intent.subject ?? ''}” is edited on.`);
  const summary = found.length === 1 ? `That is on ${found[0]!.label}.` : `That is edited on one of these screens.`;
  head(p, 'Where to change it', `${summary} Changes to records are made on their own screen, where each one asks before it saves.`);
  add(p, 'list', `List([${found.map((x) => `ListItem(${s(x.label)}, ${s(x.blurb)}, "todo", [Link(${s(`Open ${x.label}`)}, ${s(x.href)})])`).join(', ')}], "none")`);
  const next = ['What needs my attention?'];
  return { view: 'open', title: 'Where to change it', summary, program: finish(p, next), facts: found.map((x) => `Screen: ${x.label} (${x.blurb})`), next };
}

function help(lead = 'Ask about the site in your own words. Every answer is read from this site’s own records.'): Answer {
  const p = program();
  head(p, 'What you can ask', lead);
  const asks = VIEWS.filter((v) => v.name !== 'help' && v.name !== 'session');
  add(p, 'list', `Grid([${asks.map((v) => `Card([Button(${s(v.example)}, null, "ghost"), Caption(${s(v.does)})], null, 3, 1)`).join(', ')}], null, 260, 0)`);
  return { view: 'help', title: 'What you can ask', summary: lead, program: finish(p, []), facts: [], next: asks.slice(0, 3).map((v) => v.example) };
}

/** The answer for an intent, from what was read for it. */
export function compose(intent: Intent, g: Gathered, screens: readonly Screen[] = []): Answer {
  switch (intent.view) {
    case 'attention':
      return attention(g);
    case 'traffic':
      return traffic(g, intent);
    case 'sessions':
      return sessions(g, intent);
    case 'session':
      return session(g);
    case 'errors':
      return errors(g, intent);
    case 'rsvp':
      return rsvp(g, false);
    case 'pending':
      return rsvp(g, true);
    case 'guest':
      return guest(g, intent);
    case 'lifecycle':
      return lifecycle(g, intent);
    case 'jobs':
      return jobs(g);
    case 'metrics':
      return metrics(g, intent);
    case 'activity':
      return activity(g, intent);
    case 'open':
      return open(intent, screens);
    default:
      return help(intent.confidence === 0 ? 'I could not tell what that was asking for. These are the things I can look up.' : undefined);
  }
}
