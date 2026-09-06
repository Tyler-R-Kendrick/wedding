import { LIFECYCLE_MODE, suggestedStateFor, type LifecycleState } from '@/contracts/lifecycle';
import type { Principal } from '@/contracts/principal';
import { requireAdmin } from '@/lib/principal';
import type { LifecycleView } from '@/themes/types';
import { parsePreviewValue } from './preview';

export interface ResolveLifecycleInput {
  persisted: LifecycleState;
  publishedAt?: Date | string | null;
  note?: string | null;
  principal: Principal;
  /** Raw `?preview=` / cookie value, if any. */
  preview?: { value: string; source: 'query' | 'cookie' } | null;
  /** Resolved lazily: only needed when a preview value is present. */
  secret: string | (() => string);
  now: Date;
  weddingDateIso?: string;
}

/**
 * Manual publish state always beats the wall clock (ADR-0012 §2). Admin preview overlays a state
 * for this response only; it never changes the persisted row and is refused for anyone who is not
 * an admin (`requireAdmin`), whatever the token says.
 */
export function resolveLifecycle(input: ResolveLifecycleInput): LifecycleView {
  const persisted = input.persisted;
  let preview: LifecycleView['preview'] = null;
  if (input.preview?.value) {
    let admin = false;
    try {
      requireAdmin(input.principal);
      admin = true;
    } catch {
      admin = false;
    }
    if (admin) {
      const secret = typeof input.secret === 'function' ? input.secret() : input.secret;
      const parsed = parsePreviewValue(input.preview.value, secret, input.now);
      if (parsed.ok) preview = { state: parsed.value.state, source: input.preview.source, expiresAt: parsed.value.expiresAt || null };
    }
  }
  const state = preview?.state ?? persisted;
  const publishedAt = input.publishedAt ? new Date(input.publishedAt).toISOString() : null;
  return {
    state,
    mode: LIFECYCLE_MODE[state],
    persistedState: persisted,
    preview,
    suggested: suggestedStateFor(input.now, input.weddingDateIso),
    publishedAt,
    note: input.note ?? null,
  };
}
