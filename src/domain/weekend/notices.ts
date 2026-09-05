import { eq } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { weekendNotices, type NoticeSeverity, type WeekendNoticeRow } from '@/db/schema';

export async function upsertNotice(
  db: Db,
  input: { id?: string; title: string; body: string; severity: NoticeSeverity; active: boolean; startsAt: Date | null; endsAt: Date | null; by: PrincipalRef; now: Date },
): Promise<WeekendNoticeRow> {
  const id = input.id ?? newId();
  const values = { id, title: input.title, body: input.body, severity: input.severity, active: input.active, startsAt: input.startsAt, endsAt: input.endsAt, createdBy: input.by, createdAt: input.now, updatedAt: input.now };
  const [row] = await db
    .insert(weekendNotices)
    .values(values)
    .onConflictDoUpdate({ target: weekendNotices.id, set: { title: values.title, body: values.body, severity: values.severity, active: values.active, startsAt: values.startsAt, endsAt: values.endsAt, updatedAt: input.now } })
    .returning();
  return row!;
}

export async function getNotice(db: Db, id: string): Promise<WeekendNoticeRow | null> {
  return (await db.select().from(weekendNotices).where(eq(weekendNotices.id, id)).limit(1))[0] ?? null;
}
