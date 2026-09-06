import { beforeAll, describe, expect, it } from 'vitest';
import { adminExportNeeds, adminExportRsvp, adminOverrideRsvp, adminRsvpOverview, adminSetMealOptions, adminSetRsvpWindow, draftRsvp, getMyRsvp, listMyEvents, submitRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { getLifecycle, setLifecycle } from '@/db/repos/site';
import { idempotencyKeys, rsvpConfirmationEmails, rsvpResponses } from '@/db/schema';
import { FIXTURE_MEALS, FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { deliverRsvpConfirmation } from '@/domain/rsvp/email';
import { DbAuditSink, listAuditEvents } from '@/lib/audit';
import { runDueJobs } from '@/lib/jobs';
import { ok } from '@/contracts/result';
import { getProvider, resetProviders, setProviderOverride } from '@/providers/registry';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const A1 = fixturePrincipal('A1');
const A2 = fixturePrincipal('A2');
const B1 = fixturePrincipal('B1');
const admin = fixtureAdmin();
const E = FX.events;
const SECRET = 'NEEDS-SECRET-TEXT gluten free';
let db: Db;

const household = () => ({
  responses: [
    { guestId: FX.guestA1, eventId: E.ceremony, status: 'accepted' as const },
    { guestId: FX.guestA1, eventId: E.reception, status: 'accepted' as const, mealOptionId: FX.mealBeef },
    { guestId: FX.guestA2, eventId: E.reception, status: 'accepted' as const, mealOptionId: FX.mealFish },
    { guestId: FX.guestA3, eventId: E.reception, status: 'declined' as const },
  ],
  needs: [{ guestId: FX.guestA2, dietary: SECRET, accessibility: null }],
});

beforeAll(async () => {
  db = await seedSwarmE();
});

describe('RSVP window and deadline (server-side)', () => {
  it('is closed in auto mode outside RSVP_OPEN, closed after the deadline, open before it, and manual open wins', async () => {
    expectOk(await run(adminSetRsvpWindow, admin, { mode: 'auto', deadlineAt: null }));
    const closed = expectErr(await run(draftRsvp, A1, household()));
    expect(closed.code).toBe('conflict');
    expect(closed.details).toMatchObject({ reason: 'rsvp_closed' });

    await setLifecycle(db, { to: 'RSVP_OPEN', actor: { kind: 'system', component: 'test' }, requestId: 'req-lc', audit: new DbAuditSink(db) });
    expect((await getLifecycle(db))?.state).toBe('RSVP_OPEN');
    expectOk(await run(adminSetRsvpWindow, admin, { mode: 'auto', deadlineAt: '2027-06-20T05:00:00Z' }));
    const late = expectErr(await run(draftRsvp, A1, household(), { now: new Date('2027-06-21T00:00:00Z') }));
    expect(late.code).toBe('conflict');
    const inTime = expectOk(await run(draftRsvp, A1, household(), { now: new Date('2027-06-01T00:00:00Z') }));
    expect(inTime.data.window).toMatchObject({ open: true, reason: 'scheduled', deadlineAt: '2027-06-20T05:00:00.000Z' });

    const manual = expectOk(await run(adminSetRsvpWindow, admin, { mode: 'open', deadlineAt: '2027-06-20T05:00:00Z' }));
    expect(manual.data).toMatchObject({ open: true, reason: 'manual_open' });
  });
});

describe('household RSVP through draft -> confirm -> submit', () => {
  let token: string;
  let submission: unknown;
  const key = newId();

  it('drafts a proposal with a confirmation token and never persists anything', async () => {
    const before = await db.select().from(rsvpResponses);
    const draft = expectOk(await run(draftRsvp, A1, household()));
    expect(draft.confirmation?.token).toBeTruthy();
    expect(draft.data.proposal.lines).toHaveLength(4);
    expect(draft.data.proposal.needsRecordedFor).toEqual(['Ben Testhouse']);
    expect(JSON.stringify(draft.data.proposal)).not.toContain('NEEDS-SECRET');
    expect(draft.data.submission.responses[1]).toMatchObject({ guestId: FX.guestA1, eventId: E.reception, mealOptionId: FX.mealBeef, plusOne: null });
    expect(await db.select().from(rsvpResponses)).toHaveLength(before.length);
    token = draft.confirmation!.token;
    submission = draft.data.submission;
  });

  it('rejects submit without the draft token, with a tampered payload, and without an idempotency key', async () => {
    expect(expectErr(await run(submitRsvp, A1, submission, { idempotencyKey: newId() })).code).toBe('confirmation_required');
    const tampered = { ...(submission as { responses: unknown[]; needs: unknown[] }), needs: [] };
    expect(expectErr(await run(submitRsvp, A1, tampered, { idempotencyKey: newId(), confirmationToken: token })).code).toBe('confirmation_required');
    const noKey = expectErr(await run(submitRsvp, A1, submission, { noKey: true, confirmationToken: token }));
    expect(noKey.code).toBe('validation');
  });

  it('submits, audits counts only, queues a needs-free e-mail, and keeps needs out of every stored artifact', async () => {
    const requestId = 'req-rsvp-submit-1';
    const result = expectOk(await run(submitRsvp, A1, submission, { idempotencyKey: key, confirmationToken: token, requestId }));
    expect(result.data).toMatchObject({ householdId: FX.householdA, emailQueued: true, needsRecordedFor: ['Ben Testhouse'] });
    expect(result.data.lines.find((l) => l.guestId === FX.guestA2)?.mealLabel).toBe(FIXTURE_MEALS[1].label);

    const audit = await listAuditEvents(db, { requestId });
    expect(audit.map((a) => a.action).sort()).toEqual(['capability.invoked', 'rsvp.submitted']);
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain('NEEDS-SECRET');
    expect(serializedAudit).not.toContain('gluten');
    expect(serializedAudit).not.toContain(FIXTURE_MEALS[0].label);
    expect(audit.find((a) => a.action === 'rsvp.submitted')?.metadata).toEqual({ responses: 4, accepted: 3, noteRows: 1, via: 'guest' });

    const stored = await db.select().from(idempotencyKeys);
    expect(JSON.stringify(stored)).not.toContain('NEEDS-SECRET');

    const outbox = await db.select().from(rsvpConfirmationEmails);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.body).toContain('Ada');
    expect(outbox[0]!.body).toContain('Ben Testhouse');
    expect(outbox[0]!.body).not.toContain('NEEDS-SECRET');
    expect(outbox[0]!.body).toContain('notes recorded for: Ben Testhouse');

    const mine = expectOk(await run(getMyRsvp, A1, {}));
    expect(mine.data.responses).toHaveLength(4);
    expect(mine.data.needs).toEqual([{ guestId: FX.guestA2, dietary: SECRET, accessibility: null }]);
    expect(mine.data.guests.map((g) => g.guestId)).toEqual([FX.guestA1, FX.guestA2, FX.guestA3]);
  });

  it('replays the same key + payload without re-running, conflicts on a different payload, and refuses a used token', async () => {
    const versionsBefore = (await db.select().from(rsvpResponses)).map((r) => r.version);
    const replay = expectOk(await run(submitRsvp, A1, submission, { idempotencyKey: key, confirmationToken: token }));
    expect(replay.data.submittedAt).toBeTruthy();
    expect((await db.select().from(rsvpResponses)).map((r) => r.version)).toEqual(versionsBefore);
    expect(await db.select().from(rsvpConfirmationEmails)).toHaveLength(1);

    // A different payload needs its own (fresh) token; the key is what conflicts.
    const different = { ...household(), needs: [] };
    const draft2 = expectOk(await run(draftRsvp, A1, different));
    const conflict = expectErr(await run(submitRsvp, A1, draft2.data.submission, { idempotencyKey: key, confirmationToken: draft2.confirmation!.token }));
    expect(conflict.code).toBe('conflict');
    // The old token with the old payload but a different key was never redeemed twice: still single-use.

    const reused = expectErr(await run(submitRsvp, A1, submission, { idempotencyKey: newId(), confirmationToken: token }));
    expect(reused.code).toBe('confirmation_required');
    expect(reused.details).toMatchObject({ reason: 'used' });
  });

  it('is editable until the deadline: a fresh draft + submit bumps the version', async () => {
    const changed = { ...household(), responses: household().responses.map((r) => (r.guestId === FX.guestA3 ? { ...r, status: 'accepted' as const, mealOptionId: FX.mealGarden } : r)) };
    const draft = expectOk(await run(draftRsvp, A1, changed));
    expectOk(await run(submitRsvp, A1, draft.data.submission, { confirmationToken: draft.confirmation!.token }));
    const mine = expectOk(await run(getMyRsvp, A1, {}));
    const a3 = mine.data.responses.find((r) => r.guestId === FX.guestA3 && r.eventId === E.reception);
    expect(a3).toMatchObject({ status: 'accepted', mealLabel: FIXTURE_MEALS[2].label, version: 2 });
  });

  // Level 06 added `sendMessage` to AuthEmailProvider, which is the contract this level asked for, so
  // the shipped mock now delivers. Both halves below therefore install the provider they are testing
  // rather than relying on the default's capabilities — otherwise "cannot send" would quietly stop
  // being exercised the moment a provider gained the method, which is exactly what happened here.
  it('leaves the row pending when the auth-email provider cannot send messages', async () => {
    const [row] = await db.select().from(rsvpConfirmationEmails);
    const capable = getProvider('auth-email', { db });
    const { sendMessage: _omitted, ...withoutSendMessage } = capable as unknown as Record<string, unknown>;
    setProviderOverride('auth-email', withoutSendMessage as never);
    try {
      await runDueJobs(db, { worker: 'test' });
      const pending = (await db.select().from(rsvpConfirmationEmails))[0]!;
      expect(pending.id).toBe(row!.id);
      expect(pending.status).toBe('pending');
      expect(pending.lastError).toMatch(/sendMessage/);
    } finally {
      resetProviders();
    }
  });

  it('delivers the confirmation e-mail through the auth-email provider, without the needs text', async () => {
    const [row] = await db.select().from(rsvpConfirmationEmails);
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const mock = getProvider('auth-email', { db });
    setProviderOverride('auth-email', Object.assign(Object.create(Object.getPrototypeOf(mock)), mock, { sendMessage: async (m: { to: string; subject: string; text: string }) => (sent.push(m), ok({ messageId: 'msg-1' })) }));
    try {
      const delivered = await deliverRsvpConfirmation(db, row!.id);
      expect(delivered?.status).toBe('sent');
      expect(sent[0]).toMatchObject({ to: 'ada.testhouse@example.test', subject: 'Your RSVP for Sara + Tyler' });
      expect(sent[0]!.text).not.toContain('NEEDS-SECRET');
    } finally {
      resetProviders();
    }
  });
});

describe('authorization: only your own household, only entitled events', () => {
  it('rejects attendee injection from another household and non-manager answers for others', async () => {
    const injected = { responses: [{ guestId: FX.guestB1, eventId: E.ceremony, status: 'accepted' as const }], needs: [] };
    const r = expectErr(await run(draftRsvp, A1, injected));
    expect(r.code).toBe('forbidden');
    const spouse = expectErr(await run(draftRsvp, A2, { responses: [{ guestId: FX.guestA1, eventId: E.ceremony, status: 'declined' }], needs: [] }));
    expect(spouse.code).toBe('forbidden');
    const notInvited = expectErr(await run(draftRsvp, B1, { responses: [{ guestId: FX.guestB2, eventId: E.ceremony, status: 'accepted' }], needs: [] }));
    expect(notInvited.code).toBe('forbidden');
    const needsOther = expectErr(await run(draftRsvp, A2, { responses: [{ guestId: FX.guestA2, eventId: E.ceremony, status: 'accepted' }], needs: [{ guestId: FX.guestA1, dietary: 'x' }] }));
    expect(needsOther.code).toBe('forbidden');
  });

  it('scopes reads to actsFor and hides needs from assistant surfaces; submit is UI-only', async () => {
    const a2 = expectOk(await run(getMyRsvp, A2, {}));
    expect(a2.data.guests.map((g) => g.guestId)).toEqual([FX.guestA2]);
    expect(a2.data.responses.every((r) => r.guestId === FX.guestA2)).toBe(true);
    expect(JSON.stringify(a2.data)).not.toContain(FX.guestB1);
    const ai = expectOk(await run(getMyRsvp, A1, {}, { surface: 'ai' }));
    expect(ai.data.needs).toEqual([]);
    expect(JSON.stringify(ai.data)).not.toContain('NEEDS-SECRET');
    expect(expectErr(await run(submitRsvp, A1, {}, { surface: 'ai', idempotencyKey: newId() })).code).toBe('not_found');
    expect(expectErr(await run(getMyRsvp, { kind: 'anonymous' }, {})).code).toBe('unauthenticated');
    // Entitled on purpose: otherwise authorize() refuses before getMyRsvp's own guest-only guard runs,
    // and that guard — the only thing stopping an entitled admin reading a household's RSVP — is untested.
    expect(expectErr(await run(getMyRsvp, fixtureAdmin({ entitlements: new Set(['rsvp_self']) }), {})).code).toBe('forbidden');
    const events = expectOk(await run(listMyEvents, B1, {}));
    expect(events.data.events.map((e) => e.id).sort()).toEqual([E.ceremony, E.cocktailHour, E.reception].sort());
    expect(events.data.events.find((e) => e.id === E.ceremony)?.invited.map((i) => i.guestId)).toEqual([FX.guestB1]);
  });
});

describe('meal option versions', () => {
  it('publishes a new version, flags old choices stale, and rejects them on the next draft', async () => {
    const v2 = expectOk(await run(adminSetMealOptions, admin, { eventId: E.reception, options: [{ label: 'New entrée 1' }, { label: 'New entrée 2', description: 'v2' }] }));
    expect(v2.data.version).toBe(2);
    const mine = expectOk(await run(getMyRsvp, A1, {}));
    expect(mine.data.events.find((e) => e.id === E.reception)?.mealOptions.map((m) => m.label)).toEqual(['New entrée 1', 'New entrée 2']);
    expect(mine.data.responses.find((r) => r.guestId === FX.guestA1 && r.eventId === E.reception)).toMatchObject({ mealStale: true, mealLabel: FIXTURE_MEALS[0].label });
    const stale = expectErr(await run(draftRsvp, A1, { responses: [{ guestId: FX.guestA1, eventId: E.reception, status: 'accepted', mealOptionId: FX.mealBeef }], needs: [] }));
    expect(stale.code).toBe('validation');
    expect((stale.details?.issues as Array<{ code: string }>)[0]?.code).toBe('stale_meal');
    const fresh = expectOk(await run(draftRsvp, A1, { responses: [{ guestId: FX.guestA1, eventId: E.reception, status: 'accepted', mealOptionId: v2.data.options[0]!.id }], needs: [] }));
    expect(fresh.data.proposal.lines[0]?.mealLabel).toBe('New entrée 1');
  });
});

describe('admin overview, export, needs, and corrections', () => {
  it('keeps needs out of the overview and RSVP export; exposes them only via admin_export_needs (audited by name)', async () => {
    const overview = expectOk(await run(adminRsvpOverview, admin, {}));
    expect(JSON.stringify(overview.data)).not.toContain('NEEDS-SECRET');
    expect(overview.data.events.find((e) => e.id === E.reception)).toMatchObject({ invited: 6, accepted: 3, declined: 0, pending: 3, staleMeals: 3 });
    const csv = expectOk(await run(adminExportRsvp, admin, {}));
    expect(csv.data.csv).toContain('Ada Testhouse');
    expect(csv.data.csv).not.toContain('NEEDS-SECRET');
    expect(csv.data.csv.split('\r\n')[0]).not.toContain('dietary');

    expect(expectErr(await run(adminExportNeeds, admin, {})).code).toBe('validation');
    const needs = expectOk(await run(adminExportNeeds, admin, { includeNeeds: true }, { requestId: 'req-needs-1' }));
    expect(needs.data.rows).toEqual([{ guestId: FX.guestA2, displayName: 'Ben Testhouse', householdName: 'Testhouse household', dietary: SECRET, accessibility: null }]);
    expect(needs.data.csv).toContain('gluten');
    const trail = await listAuditEvents(db, { requestId: 'req-needs-1' });
    expect(trail[0]).toMatchObject({ action: 'capability.invoked', targetId: 'admin_export_needs' });
    expect(JSON.stringify(trail)).not.toContain('NEEDS-SECRET');
    expect(expectErr(await run(adminExportNeeds, A1, { includeNeeds: true })).code).toBe('forbidden');
    expect(expectErr(await run(adminExportNeeds, fixtureAdmin({ entitlements: new Set(['admin_content']) }), { includeNeeds: true })).code).toBe('forbidden');
  });

  it('records corrections after the deadline with rsvp.admin_override and the reason', async () => {
    expectOk(await run(adminSetRsvpWindow, admin, { mode: 'closed', deadlineAt: null }));
    expect(expectErr(await run(draftRsvp, A1, household())).code).toBe('conflict');
    const fix = expectOk(await run(adminOverrideRsvp, admin, { guestId: FX.guestA2, eventId: E.reception, status: 'declined', reason: 'Phone call 2027-06-22' }, { requestId: 'req-override-1' }));
    expect(fix.data).toMatchObject({ status: 'declined', previousStatus: 'accepted', version: 3 });
    const audit = (await listAuditEvents(db, { requestId: 'req-override-1', action: 'rsvp.admin_override' }))[0];
    expect(audit).toMatchObject({ targetType: 'guest', targetId: FX.guestA2, metadata: { eventId: E.reception, from: 'accepted', to: 'declined', reason: 'Phone call 2027-06-22' } });
    const mine = expectOk(await run(getMyRsvp, A2, {}));
    expect(mine.data.responses.find((r) => r.eventId === E.reception)).toMatchObject({ status: 'declined', version: 3 });
    expect(expectErr(await run(adminOverrideRsvp, admin, { guestId: FX.guestB2, eventId: E.ceremony, status: 'accepted', reason: 'oops' })).code).toBe('forbidden');
    expect(expectErr(await run(adminOverrideRsvp, fixtureAdmin({ entitlements: new Set(['admin_content']) }), { guestId: FX.guestA2, eventId: E.reception, status: 'accepted', reason: 'planner without guest ops' })).code).toBe('forbidden');
    expect(expectErr(await run(adminOverrideRsvp, A1, { guestId: FX.guestA2, eventId: E.reception, status: 'accepted', reason: 'guest trying' })).code).toBe('forbidden');
  });
});
