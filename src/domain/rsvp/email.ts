import { eq } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guests, rsvpConfirmationEmails, type RsvpConfirmationEmailRow } from '@/db/schema';
import { JobQueue, registerJobHandler } from '@/lib/jobs';
import { getProvider } from '@/providers/registry';
import type { AuthEmailProvider } from '@/providers/auth-email/types';

export const RSVP_CONFIRMATION_JOB = 'rsvp.send_confirmation';

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Contract change requested from Swarm D (owner of src/providers/auth-email): add
 * `sendMessage(message: TransactionalEmail)` to `AuthEmailProvider` (mock -> dev inbox, Resend -> API).
 * Until it lands the outbox keeps rows `pending` with a clear `lastError`; nothing is lost or faked.
 */
export interface TransactionalEmailCapable {
  sendMessage?: (message: TransactionalEmail) => Promise<Result<{ messageId: string }, ProviderFailure>>;
}

/** Writes the outbox row and enqueues delivery. Body never contains needs text (see buildConfirmationEmail). */
export async function queueRsvpConfirmation(
  db: Db,
  input: { householdId: string; recipientGuestId: string; subject: string; body: string; now: Date },
): Promise<RsvpConfirmationEmailRow> {
  const [row] = await db
    .insert(rsvpConfirmationEmails)
    .values({ id: newId(), householdId: input.householdId, recipientGuestId: input.recipientGuestId, subject: input.subject, body: input.body, status: 'pending', attempts: 0, createdAt: input.now })
    .returning();
  await new JobQueue(db).enqueue({ type: RSVP_CONFIRMATION_JOB, payload: { outboxId: row!.id }, dedupeKey: `rsvp-email:${row!.id}` });
  return row!;
}

/** Sends one outbox row through the auth-email provider. Exported for tests and the job handler. */
export async function deliverRsvpConfirmation(db: Db, outboxId: string, now: Date = new Date()): Promise<RsvpConfirmationEmailRow | null> {
  const row = (await db.select().from(rsvpConfirmationEmails).where(eq(rsvpConfirmationEmails.id, outboxId)).limit(1))[0];
  if (!row || row.status === 'sent') return row ?? null;
  const recipient = (await db.select({ email: guests.email }).from(guests).where(eq(guests.id, row.recipientGuestId)).limit(1))[0];
  const update = async (patch: Partial<RsvpConfirmationEmailRow>) => (await db.update(rsvpConfirmationEmails).set(patch).where(eq(rsvpConfirmationEmails.id, row.id)).returning())[0]!;
  if (!recipient?.email) return update({ status: 'skipped', lastError: 'recipient has no e-mail on file', attempts: row.attempts + 1 });
  const provider = getProvider('auth-email', { db }) as AuthEmailProvider & TransactionalEmailCapable;
  if (typeof provider.sendMessage !== 'function') {
    return update({ status: 'pending', lastError: 'auth-email provider has no sendMessage (contract change requested from Swarm D)', attempts: row.attempts + 1 });
  }
  const sent = await provider.sendMessage({ to: recipient.email, subject: row.subject, text: row.body });
  if (!sent.ok) {
    // Provider failures carry guest-safe messages; the raw cause never reaches the row.
    await update({ status: 'failed', lastError: `${sent.error.provider}: ${sent.error.class}`, attempts: row.attempts + 1 });
    throw new Error(`rsvp confirmation delivery failed (${sent.error.class})`); // lets the job queue retry with backoff
  }
  return update({ status: 'sent', providerMessageId: sent.value.messageId, sentAt: now, attempts: row.attempts + 1, lastError: null });
}

let registered = false;
/** Idempotent registration; called from instrumentation.ts and from the capabilities module. */
export function registerRsvpJobs(): void {
  if (registered) return;
  registered = true;
  registerJobHandler<{ outboxId: string }>(RSVP_CONFIRMATION_JOB, async (payload, _job, ctx) => {
    const row = await deliverRsvpConfirmation(ctx.db, payload.outboxId, ctx.now);
    ctx.logger.info({ outboxId: payload.outboxId, status: row?.status }, 'rsvp confirmation processed');
  });
}
