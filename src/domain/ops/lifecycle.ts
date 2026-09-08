import { desc, inArray } from 'drizzle-orm';
import { canTransition, LIFECYCLE_MODE, LIFECYCLE_STATES, suggestedStateFor, type LifecycleState } from '@/contracts/lifecycle';
import type { Db } from '@/db/client';
import { auditEvents } from '@/db/schema';
import { navFor } from '@/domain/lifecycle/nav';
import { actorView, projectAuditMetadata } from './audit';

export interface LifecycleTransitionView {
  to: LifecycleState;
  direction: 'forward' | 'back';
  /** Guest-visible navigation that appears / disappears when the site moves here. */
  navGained: string[];
  navLost: string[];
  mode: string;
}

export interface LifecycleHistoryRow {
  id: string;
  at: string;
  action: string;
  actor: { kind: string; ref: string | null };
  outcome: string;
  requestId: string;
  metadata: Record<string, string> | null;
}

export interface LifecycleStatusView {
  state: LifecycleState;
  mode: string;
  publishedAt: string | null;
  publishedBy: { kind: string; ref: string | null } | null;
  /** The publisher's own note on the row. Admin-authored, admin-only; nothing guest-facing renders it. */
  note: string | null;
  suggested: LifecycleState;
  /** True when the calendar has moved past the published state and nobody has published yet. */
  behindSchedule: boolean;
  states: LifecycleState[];
  transitions: LifecycleTransitionView[];
  history: LifecycleHistoryRow[];
}

const navLabels = (state: LifecycleState): string[] => {
  const nav = navFor(state);
  return [...nav.primary, ...nav.more].map((i) => i.label);
};

/** What a move to `to` changes for a guest, computed from the same nav model the site renders. */
export function describeTransition(from: LifecycleState, to: LifecycleState): LifecycleTransitionView {
  const before = new Set(navLabels(from));
  const after = new Set(navLabels(to));
  return {
    to,
    direction: LIFECYCLE_STATES.indexOf(to) > LIFECYCLE_STATES.indexOf(from) ? 'forward' : 'back',
    navGained: [...after].filter((l) => !before.has(l)),
    navLost: [...before].filter((l) => !after.has(l)),
    mode: LIFECYCLE_MODE[to],
  };
}

/** Every state `canTransition` allows from here: forward by any distance, back by exactly one. */
export const allowedTransitions = (from: LifecycleState): LifecycleTransitionView[] =>
  LIFECYCLE_STATES.filter((s) => canTransition(from, s)).map((s) => describeTransition(from, s));

export async function lifecycleStatus(
  db: Db,
  input: { state: LifecycleState; publishedAt: Date | null; publishedBy: unknown; note: string | null; now: Date; weddingDateIso?: string; historyLimit?: number },
): Promise<LifecycleStatusView> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(inArray(auditEvents.action, ['lifecycle.published', 'lifecycle.previewed']))
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(input.historyLimit ?? 25);
  const suggested = suggestedStateFor(input.now, input.weddingDateIso);
  const by = input.publishedBy as Record<string, unknown> | null;
  return {
    state: input.state,
    mode: LIFECYCLE_MODE[input.state],
    publishedAt: input.publishedAt?.toISOString() ?? null,
    publishedBy: by ? actorView(by as never) : null,
    note: input.note ? input.note.slice(0, 500) : null,
    suggested,
    behindSchedule: LIFECYCLE_STATES.indexOf(suggested) > LIFECYCLE_STATES.indexOf(input.state),
    states: [...LIFECYCLE_STATES],
    transitions: allowedTransitions(input.state),
    history: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      actor: actorView(r.actor),
      outcome: r.outcome,
      requestId: r.requestId,
      metadata: projectAuditMetadata(r.metadata).metadata,
    })),
  };
}
