import { beforeAll, describe, expect, it } from 'vitest';
import { adminAssistantAnswer } from '@/capabilities/ops';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { FX } from '@/db/seed/fixtures';
import { seedTelemetryFixtures } from '@/db/seed/telemetry-fixtures';
import { PROPOSABLE, READ_TOOLS } from '@/domain/admin-assistant';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const ALL = ['admin_integrations', 'admin_lifecycle', 'admin_guest_ops', 'admin_audit', 'admin_content'];
const admin = (entitlements: string[] = ALL): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-ASK' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'assistant-session',
});

const ask = async (message: string, principal: Principal = admin(), choice?: Record<string, unknown>) => run(adminAssistantAnswer, principal, { message, ...(choice ? { choice } : {}) });
const tools = (program: string) => [...program.matchAll(/Query\("([a-z_]+)"/g)].map((m) => m[1]!);

/**
 * `admin_assistant_answer` through the real pipeline and a real database: what it reads, for whom,
 * and what it never does. The composer and the router have their own unit tests; this is the part
 * only the pipeline can prove — that an answer is limited by the caller's role exactly as a screen
 * is, and that asking changes nothing.
 */
describe('admin_assistant_answer', () => {
  beforeAll(async () => {
    await seedSwarmE();
    await seedTelemetryFixtures(await getDb());
  });

  it('is for administrators', async () => {
    expect(expectErr(await ask('What needs my attention?', { kind: 'anonymous' })).code).toBe('unauthenticated');
    expect(expectErr(await ask('What needs my attention?', { kind: 'guest', guestId: FX.guestA1 } as unknown as Principal)).code).toBe('forbidden');
  });

  it('answers a visits question from the telemetry records, as a program over tools on the list', async () => {
    const { data } = expectOk(await ask('How many visits this week?'));
    expect(data).toMatchObject({ view: 'traffic', understood: true, window: 168, title: 'Visits' });
    expect(data.summary).toMatch(/^\d+ sessions and \d+ pages opened in the last 7 days/);
    expect(tools(data.program)).toEqual(['admin_site_traffic']);
    expect(data.read).toEqual([{ tool: 'admin_site_traffic', title: expect.any(String), ok: true }]);
    expect(data.facts.some((f) => f.startsWith('Sessions: '))).toBe(true);
  });

  it('reads only what the caller’s role may read, and says so instead of showing an empty answer', async () => {
    // A planner-like administrator: guests, not integrations.
    const planner = admin(['admin_guest_ops']);
    const visits = expectOk(await ask('How many visits this week?', planner)).data;
    expect(visits.title).toBe('Not part of your access');
    expect(visits.read).toEqual([{ tool: 'admin_site_traffic', title: expect.any(String), ok: false }]);
    expect(tools(visits.program)).toEqual([]);
    // The same person may read replies, and gets them.
    const replies = expectOk(await ask('How many guests have replied?', planner)).data;
    expect(replies).toMatchObject({ view: 'rsvp', title: 'Replies' });
    // The checklist is built from whatever of its five reads were allowed.
    const plan = expectOk(await ask('What needs my attention?', planner)).data;
    expect(plan.read.filter((r) => r.ok).map((r) => r.tool)).toEqual(['admin_rsvp_overview']);
    expect(plan.read).toHaveLength(5);
  });

  it('proposes a lifecycle change through the draft step and publishes nothing', async () => {
    const before = expectOk(await ask('What state is the site in? lifecycle')).data;
    const { data } = expectOk(await ask('Publish Wedding week'));
    expect(data.view).toBe('lifecycle');
    expect(data.program).toContain('"admin_publish_lifecycle", {to: "WEDDING_WEEK"}, "Publish Wedding week", false, "draft_lifecycle_transition")');
    // Asking is a read: the published state is what it was.
    const after = expectOk(await ask('lifecycle status')).data;
    expect(after.facts[0]).toBe(before.facts[0]);
  });

  it('a choice selects which records are read and cannot name a capability', async () => {
    const chosen = expectOk(await ask('anything at all', admin(), { view: 'errors', window: 24 })).data;
    expect(chosen).toMatchObject({ view: 'errors', window: 24, understood: true });
    expect(expectErr(await ask('x', admin(), { view: 'admin_delete_guest' })).code).toBe('validation');
    expect(expectErr(await ask('x'.repeat(501))).code).toBe('validation');
  });

  it('says what can be asked when it cannot tell what was asked', async () => {
    const { data } = expectOk(await ask('purple monkey dishwasher'));
    expect(data).toMatchObject({ view: 'help', understood: false, read: [] });
  });

  it('every view composes for a real database, and queries and proposes only what is on the two lists', async () => {
    const questions = ['What needs my attention?', 'How many visits this week?', 'Who visited today?', 'What errors did guests hit?', 'How many guests have replied?', 'Who has not replied?', 'Are any jobs stuck?', 'What is slow?', 'What changed recently?', 'What was refused?', 'Where do I edit the hotel block?', 'Open RSVPs'];
    for (const q of questions) {
      const { data } = expectOk(await ask(q));
      expect(data.understood, q).toBe(true);
      expect(data.program.startsWith('root = Col(['), q).toBe(true);
      for (const tool of tools(data.program)) expect(READ_TOOLS as readonly string[], `${q}: ${tool}`).toContain(tool);
      for (const m of data.program.matchAll(/Proposal\((?:"(?:[^"\\]|\\.)*", ){2}"([a-z_]+)"/g)) expect(PROPOSABLE as readonly string[], q).toContain(m[1]);
    }
  });

  it('one named guest: their household, their replies and their visits', async () => {
    const { data } = expectOk(await ask('What has Ada Testhouse done on the site?'));
    expect(data.view).toBe('guest');
    expect(data.title).toBe('Ada Testhouse');
    expect(data.read.map((r) => r.tool)).toEqual(['admin_list_guests', 'admin_list_guests', 'admin_list_sessions', 'admin_rsvp_overview']);
    expect(data.summary).toContain('Testhouse');
  });
});
