import { eq } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { canTransition, type LifecycleState } from '@/contracts/lifecycle';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '../client';
import { contentSources, lifecycleState, siteSettings, type ContentSourceRow, type LifecycleRow, type SiteSettingsRow } from '../schema';

export async function getSiteSettings(db: Db): Promise<SiteSettingsRow | null> {
  const rows = await db.select().from(siteSettings).limit(1);
  return rows[0] ?? null;
}

export async function getLifecycle(db: Db): Promise<LifecycleRow | null> {
  const rows = await db.select().from(lifecycleState).where(eq(lifecycleState.id, 'current')).limit(1);
  return rows[0] ?? null;
}

/** Manual lifecycle publish. Validates the transition, writes the row, audits. */
export async function setLifecycle(
  db: Db,
  input: { to: LifecycleState; actor: PrincipalRef; requestId: string; note?: string; audit: AuditSink },
): Promise<Result<LifecycleRow, CapabilityError>> {
  const current = await getLifecycle(db);
  const from = current?.state ?? 'TEASER';
  if (current && !canTransition(from, input.to)) {
    return err(new CapabilityError('conflict', `Cannot move the site from ${from} to ${input.to}.`, { from, to: input.to }));
  }
  const [row] = await db
    .insert(lifecycleState)
    .values({ id: 'current', state: input.to, publishedAt: new Date(), publishedBy: input.actor, note: input.note ?? null })
    .onConflictDoUpdate({
      target: lifecycleState.id,
      set: { state: input.to, publishedAt: new Date(), publishedBy: input.actor, note: input.note ?? null },
    })
    .returning();
  await input.audit.record({
    actor: input.actor,
    action: 'lifecycle.published',
    target: { type: 'lifecycle', id: 'current' },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { from, to: input.to },
  });
  return ok(row!);
}

export async function listContentSources(db: Db): Promise<ContentSourceRow[]> {
  return db.select().from(contentSources);
}

export async function getContentSource(db: Db, id: string): Promise<ContentSourceRow | null> {
  const rows = await db.select().from(contentSources).where(eq(contentSources.id, id)).limit(1);
  return rows[0] ?? null;
}
