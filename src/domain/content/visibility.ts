import type { CapabilityExposure } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { CONTENT_VISIBILITIES, type ContentVisibility } from '@/db/schema/content';

export { CONTENT_VISIBILITIES, type ContentVisibility };

export type Surface = keyof CapabilityExposure;

/**
 * Which visibility scopes a principal may read on a surface.
 *  - `public`        everyone
 *  - `guest`         signed-in guests, admins, system
 *  - `private-draft` admins holding `admin_content` (and system jobs) on the UI surface ONLY.
 * The AI and WebMCP surfaces never see drafts, whoever is asking (ADR-0003 rule 8: the concierge
 * has no admin view). Hidden UI is not authorization: every capability filters with this.
 */
export function allowedVisibilities(principal: Principal, surface: Surface = 'ui'): ContentVisibility[] {
  const scopes: ContentVisibility[] = ['public'];
  if (principal.kind === 'guest' || principal.kind === 'admin' || principal.kind === 'system') scopes.push('guest');
  const aiSurface = surface === 'ai' || surface === 'webmcp';
  if (!aiSurface) {
    if (principal.kind === 'system') scopes.push('private-draft');
    else if (principal.kind === 'admin' && principal.entitlements.has('admin_content')) scopes.push('private-draft');
  }
  return scopes;
}

export function canSee(principal: Principal, surface: Surface, visibility: ContentVisibility): boolean {
  return allowedVisibilities(principal, surface).includes(visibility);
}

/** Only admins with `admin_content` (on the UI surface) may see expired or not-yet-valid records. */
export function canSeeExpired(principal: Principal, surface: Surface = 'ui'): boolean {
  if (surface === 'ai' || surface === 'webmcp') return false;
  return principal.kind === 'system' || (principal.kind === 'admin' && principal.entitlements.has('admin_content'));
}

export interface ValidityWindow {
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
}

/** True when `now` is inside the record's validity window. */
export function isValidAt(row: ValidityWindow, now: Date): boolean {
  const t = now.getTime();
  const from = row.validFrom ? new Date(row.validFrom).getTime() : undefined;
  const until = row.validUntil ? new Date(row.validUntil).getTime() : undefined;
  if (from !== undefined && t < from) return false;
  if (until !== undefined && t > until) return false;
  return true;
}

export interface Scoped extends ValidityWindow {
  visibility: ContentVisibility;
}

/**
 * The one filter every read capability applies before returning rows: visibility by principal
 * and surface, and validity by wall clock unless the caller may see expired records.
 */
export function filterVisible<T extends Scoped>(rows: readonly T[], principal: Principal, surface: Surface, now: Date, opts: { includeExpired?: boolean } = {}): T[] {
  const scopes = new Set(allowedVisibilities(principal, surface));
  const showExpired = opts.includeExpired === true && canSeeExpired(principal, surface);
  return rows.filter((r) => scopes.has(r.visibility) && (showExpired || isValidAt(r, now)));
}
