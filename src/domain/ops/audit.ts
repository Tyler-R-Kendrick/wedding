import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { AUDIT_ACTIONS, isAuditSensitive, redactForAudit, type AuditAction, type AuditOutcome } from '@/contracts/audit';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { auditEvents } from '@/db/schema';

export const AUDIT_PAGE_MAX = 200;
export const AUDIT_PAGE_DEFAULT = 50;

export interface AuditFilter {
  actions?: readonly AuditAction[];
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  actorKind?: PrincipalRef['kind'];
  from?: Date;
  to?: Date;
  limit?: number;
  /** Keyset cursor from a previous page: everything strictly older than (at, id). */
  cursor?: { at: Date; id: string };
}

export interface AuditRowView {
  id: string;
  at: string;
  actor: { kind: string; ref: string | null };
  action: AuditAction;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  requestId: string;
  metadata: Record<string, string> | null;
  /** True when at least one metadata value was withheld or shortened by the read-time filter. */
  metadataRedacted: boolean;
}

/**
 * How much of one metadata value an admin ever sees. The rows are already redacted on write
 * (`redactForAudit`), so this is the second pass, not the first: it exists because the audit UI is a
 * read surface over the record of everything everyone did, and a key added later by code that
 * forgets the write-time rule must not become readable just because a page renders `metadata`.
 */
const VALUE_MAX_CHARS = 120;
const MAX_KEYS = 24;

/**
 * Keys whose *values* are never rendered, on top of the write-time redaction. Every one of these
 * carries free text a person typed (`reason` on an identity reset, `note` on a readiness switch, a
 * concierge question) rather than a count, an enum or an opaque id — and free text is where a guest's
 * email, a voucher code or a dietary note ends up when someone pastes one into an admin form. They
 * are shown as present, so the trail still records that a reason was given, without reprinting it
 * into a screen a moderator (`admin_audit`, no `admin_guest_ops`) can read. Deliberately an exact
 * set, not a prefix match: `reasons` (the concierge's enum list) and `references` (a count) stay
 * readable because they are not free text.
 */
const WITHHELD_KEYS: ReadonlySet<string> = new Set(['note', 'notes', 'reason', 'question', 'answer', 'message', 'comment', 'description', 'summary', 'freeText', 'text']);

/**
 * The read-time redaction. It was written STRICTER than the write-time one, because that one
 * anchored its pattern at the start of the key and so would have stored `guestEmail`,
 * `contactPhone` and `mailingAddress` verbatim. That gap is now closed at the write side itself
 * (`isAuditSensitive`), which is where it belonged — a row this screen never renders is still in
 * the table for psql and for exports. What stays stricter HERE is what only a screen needs: free
 * text is withheld entirely, values are capped, and the key count is capped.
 */
/**
 * The write-time redactor is now the single source of both the sensitive-word list and the
 * boolean/enum rules (`isAuditSensitive`, level 14). Two copies of a security list drift; this file
 * keeps only what is genuinely STRICTER on read — the withheld free-text keys above, the value
 * length cap and the key cap — and defers the rest.
 */
const isSensitive = isAuditSensitive;

/** Anything not a primitive is summarised by shape, exactly as the write-time redactor does. */
function renderValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value === 'object') return '[object]';
  return String(value);
}

/**
 * Read-time projection of one audit row's metadata. Never returns a value longer than
 * `VALUE_MAX_CHARS`, never returns more than `MAX_KEYS` keys, and never returns the value of a
 * withheld key. Returns whether anything was held back so the UI can say so rather than imply the
 * row was empty.
 */
export function projectAuditMetadata(raw: Record<string, unknown> | null | undefined): { metadata: Record<string, string> | null; redacted: boolean } {
  if (!raw) return { metadata: null, redacted: false };
  const safe = redactForAudit(raw) ?? {};
  const entries = Object.entries(safe);
  let redacted = entries.length > MAX_KEYS;
  const out: Record<string, string> = {};
  for (const [key, value] of entries.slice(0, MAX_KEYS)) {
    if (WITHHELD_KEYS.has(key)) {
      out[key] = '[withheld]';
      redacted = true;
      continue;
    }
    if (isSensitive(key, value)) {
      out[key] = '[redacted]';
      redacted = true;
      continue;
    }
    const rendered = renderValue(value);
    if (rendered.length > VALUE_MAX_CHARS) {
      out[key] = `${rendered.slice(0, VALUE_MAX_CHARS)}…`;
      redacted = true;
      continue;
    }
    if (rendered === '[redacted]') redacted = true;
    out[key] = rendered;
  }
  return { metadata: out, redacted };
}

/** A principal reference reduced to what an audit reader needs: the kind, and an opaque id. */
export function actorView(actor: PrincipalRef): { kind: string; ref: string | null } {
  const a = actor as Record<string, unknown>;
  const ref = a.adminId ?? a.guestId ?? a.component ?? null;
  return { kind: String(a.kind ?? 'unknown'), ref: typeof ref === 'string' ? ref : null };
}

export const isAuditAction = (v: string): v is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(v);

/** One page of the audit trail, newest first, with a keyset cursor for the next page. */
export async function searchAuditEvents(db: Db, filter: AuditFilter = {}): Promise<{ rows: AuditRowView[]; nextCursor: { at: string; id: string } | null }> {
  const limit = Math.min(Math.max(filter.limit ?? AUDIT_PAGE_DEFAULT, 1), AUDIT_PAGE_MAX);
  const where = [
    filter.actions?.length ? inArray(auditEvents.action, filter.actions as AuditAction[]) : undefined,
    filter.outcome ? eq(auditEvents.outcome, filter.outcome) : undefined,
    filter.targetType ? eq(auditEvents.targetType, filter.targetType) : undefined,
    filter.targetId ? eq(auditEvents.targetId, filter.targetId) : undefined,
    filter.requestId ? eq(auditEvents.requestId, filter.requestId) : undefined,
    filter.actorKind ? sql`${auditEvents.actor}->>'kind' = ${filter.actorKind}` : undefined,
    filter.from ? gte(auditEvents.at, filter.from) : undefined,
    filter.to ? lte(auditEvents.at, filter.to) : undefined,
    filter.cursor ? or(lt(auditEvents.at, filter.cursor.at), and(eq(auditEvents.at, filter.cursor.at), lt(auditEvents.id, filter.cursor.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select()
    .from(auditEvents)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => {
      const { metadata, redacted } = projectAuditMetadata(r.metadata);
      return {
        id: r.id,
        at: r.at.toISOString(),
        actor: actorView(r.actor),
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        outcome: r.outcome,
        requestId: r.requestId,
        metadata,
        metadataRedacted: redacted,
      };
    }),
    nextCursor: rows.length > limit && last ? { at: last.at.toISOString(), id: last.id } : null,
  };
}

/** Totals for the current filter window: how many rows, and how they came out. */
export async function auditTotals(db: Db, filter: Pick<AuditFilter, 'from' | 'to'> = {}): Promise<{ total: number; byOutcome: Record<string, number>; topActions: { action: string; count: number }[] }> {
  const where = [filter.from ? gte(auditEvents.at, filter.from) : undefined, filter.to ? lte(auditEvents.at, filter.to) : undefined].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const rows = await db
    .select({ action: auditEvents.action, outcome: auditEvents.outcome, count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where.length ? and(...where) : undefined)
    .groupBy(auditEvents.action, auditEvents.outcome);
  const byOutcome: Record<string, number> = {};
  const byAction = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.count);
    total += n;
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + n;
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + n);
  }
  const topActions = [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)).slice(0, 12);
  return { total, byOutcome, topActions };
}
