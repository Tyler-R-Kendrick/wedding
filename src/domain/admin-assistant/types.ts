import type { ViewName } from './catalog';

/*
 * The shapes the assistant reads. Each mirrors the output of the capability named beside it; they
 * are restated here, not imported, so this domain stays free of the capability layer and can be
 * tested with plain objects.
 */

/** admin_site_traffic */
export type Traffic = {
  windowHours: number;
  since: string;
  recording: boolean;
  totals: { sessions: number; pageviews: number; signedInSessions: number; guests: number; errors: number; erroredSessions: number; medianDurationSeconds: number | null };
  previous: { sessions: number; pageviews: number; errors: number };
  series: { at: string; sessions: number; pageviews: number; errors: number }[];
  topPages: { path: string; views: number; sessions: number; errors: number }[];
  devices: { device: string; sessions: number }[];
  browsers: { browser: string; sessions: number }[];
  vitals: { name: 'LCP' | 'CLS' | 'INP'; p75: number; samples: number }[];
};

export type SessionRow = {
  id: string;
  startedAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  who: { kind: 'anonymous' | 'guest' | 'admin'; guestId?: string; name?: string };
  device: string;
  browser: string;
  entryPath: string;
  exitPath: string;
  pageviews: number;
  errors: number;
};
/** admin_list_sessions */
export type SessionList = { total: number; sessions: SessionRow[] };
/** admin_session_detail */
export type SessionDetail = { session: SessionRow; events: { at: string; kind: 'view' | 'error' | 'vital'; path: string; name?: string; value?: number; message?: string }[] };

/** admin_site_errors */
export type ErrorGroups = {
  windowHours: number;
  total: number;
  groups: { fingerprint: string; message: string; name: string | null; source: 'client' | 'server'; count: number; sessions: number; firstAt: string; lastAt: string; paths: string[]; sample: { path: string; stack?: string; sessionId?: string } }[];
};

/** admin_lifecycle_status (the fields read here) */
export type Lifecycle = { state: string; suggested: string; behindSchedule: boolean; publishedAt: string | null; states: string[] };

export type JobRow = { id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; updatedAt: string };
/** admin_jobs_overview (the fields read here) */
export type Jobs = { byStatus: Record<string, number>; dueNow: number; oldestDueAgeSeconds: number | null; attention: JobRow[]; byType: { type: string; total: number; queued: number; running: number; succeeded: number; dead: number }[] };

export type RsvpRow = { guestId: string; displayName: string; householdName: string; eventId: string; eventName: string; status: string | null; updatedAt: string | null };
/** admin_rsvp_overview (the fields read here) */
export type Rsvp = {
  window: { open: boolean; deadlineAt: string | null };
  events: { id: string; name: string; invited: number; accepted: number; declined: number; pending: number; plusOnes: number }[];
  rows: RsvpRow[];
};

/** admin_ops_metrics (the fields read here) */
export type Metrics = {
  windowHours: number;
  recording: boolean;
  totalPoints: number;
  series: { name: string; kind: 'counter' | 'histogram'; points: number; sum: number; max: number; p50: number | null; p95: number | null; lastAt: string }[];
  audit: { total: number; byOutcome: Record<string, number>; topActions: { action: string; count: number }[] };
};

export type AuditRow = { id: string; at: string; actor: { kind: string; ref: string | null }; action: string; targetType: string; targetId: string; outcome: 'success' | 'denied' | 'failed' };
/** admin_search_audit (the fields read here) */
export type Audit = { rows: AuditRow[]; window: { total: number; byOutcome: Record<string, number> } };

/** admin_list_guests (the fields read here) */
export type Guest = { id: string; displayName: string; householdName: string; email: string | null; kind: string; isMinor: boolean; claimed: boolean; claimedAt: string | null };

/** What was read for one answer. `null` is "not part of this administrator's access, or not available". */
export type Gathered = {
  now: string;
  traffic?: Traffic | null;
  sessions?: SessionList | null;
  session?: SessionDetail | null;
  errors?: ErrorGroups | null;
  lifecycle?: Lifecycle | null;
  jobs?: Jobs | null;
  rsvp?: Rsvp | null;
  metrics?: Metrics | null;
  audit?: Audit | null;
  guests?: Guest[] | null;
};

/** What the router made of a message. */
export type Intent = {
  view: ViewName;
  /** Hours: 24, 168 or 720. */
  window?: number;
  /** A lifecycle state named in the message ("open RSVPs" → RSVP_OPEN). */
  state?: string;
  /** Sessions with errors only. */
  withErrors?: boolean;
  /** Words that may be a guest's name or a screen's. */
  subject?: string;
  sessionId?: string;
  /** Audit rows that were refused. */
  denied?: boolean;
  /** How sure the router is: below 2 the browser's model, when there is one, is asked instead. */
  confidence: number;
};

export type Answer = {
  view: ViewName;
  /** A short name for the answer, for the conversation's own heading and history. */
  title: string;
  /** One or two plain sentences: the answer in words. */
  summary: string;
  /** An OpenUI Lang program for the console's library. */
  program: string;
  /** The facts the summary rests on, one per line; the only numbers a rewrite may use. */
  facts: string[];
  /** Follow-up questions, in the administrator's voice. */
  next: string[];
};
