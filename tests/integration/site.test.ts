import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke, siteStatus, invokeByName } from '@/capabilities';
import { getDb } from '@/db/client';
import { getLifecycle, setLifecycle } from '@/db/repos/site';
import { DbAuditSink, listAuditEvents } from '@/lib/audit';
import { isEnabled, invalidateReadinessCache, setReadiness } from '@/lib/flags';
import { readFlags } from '@/contracts/flags';

describe('site_status capability', () => {
  it('returns lifecycle, wedding facts, themes and a citation, and audits the read', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-site-1', surface: 'ai' });
    const r = await invoke(siteStatus, ctx, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data).toMatchObject({
      lifecycle: { state: 'TEASER', mode: 'explore', suggested: expect.any(String) },
      wedding: { coupleDisplayName: 'Sara + Tyler', date: '2027-07-17', timezone: 'America/Chicago', venueName: 'Chicago Athletic Association Hotel' },
      themes: ['gilded-hour', 'conservatory'],
      defaultTheme: 'gilded-hour',
    });
    expect(r.value.sources[0]).toMatchObject({ title: "Tyler's brief 2026-09-04" });
    const db = await getDb();
    const rows = await listAuditEvents(db, { requestId: 'req-site-1' });
    expect(rows[0]).toMatchObject({ action: 'capability.invoked', targetId: 'site_status', metadata: { surface: 'ai' } });
    expect(rows[0]!.metadata).not.toHaveProperty('inputHash'); // reads carry no input fingerprint
  });

  it('is reachable by name and unknown names are not found', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-site-2' });
    expect((await invokeByName('site_status', ctx, undefined)).ok).toBe(true);
    const missing = await invokeByName('nope', ctx, {});
    expect(!missing.ok && missing.error.code).toBe('not_found');
  });
});

describe('lifecycle + readiness', () => {
  it('publishes valid transitions with an audit row and rejects invalid ones', async () => {
    const db = await getDb();
    const audit = new DbAuditSink(db);
    const actor = { kind: 'system' as const, component: 'test' };
    const ok = await setLifecycle(db, { to: 'SAVE_THE_DATE', actor, requestId: 'req-lc-1', audit, note: 'go' });
    expect(ok.ok && ok.value.state).toBe('SAVE_THE_DATE');
    const bad = await setLifecycle(db, { to: 'TEASER', actor, requestId: 'req-lc-2', audit });
    expect(bad.ok).toBe(true); // one step back is allowed
    const two = await setLifecycle(db, { to: 'RSVP_OPEN', actor, requestId: 'req-lc-3', audit });
    expect(two.ok).toBe(true);
    const back2 = await setLifecycle(db, { to: 'SAVE_THE_DATE', actor, requestId: 'req-lc-4', audit });
    expect(!back2.ok && back2.error.code).toBe('conflict');
    expect((await getLifecycle(db))?.state).toBe('RSVP_OPEN');
    expect(await listAuditEvents(db, { action: 'lifecycle.published' })).toHaveLength(3);
  });

  it('gates readiness flags on env AND the persisted row', async () => {
    const db = await getDb();
    invalidateReadinessCache();
    const flagsOn = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on' });
    expect(await isEnabled('BIOMETRICS_ENABLED', { flags: flagsOn, db })).toBe(false);
    await setReadiness(db, { flag: 'BIOMETRICS_ENABLED', ready: true, actor: { kind: 'system', component: 'test' }, requestId: 'req-flag-1', audit: new DbAuditSink(db) });
    expect(await isEnabled('BIOMETRICS_ENABLED', { flags: flagsOn, db })).toBe(true);
    expect(await isEnabled('BIOMETRICS_ENABLED', { flags: readFlags({}), db })).toBe(false);
    expect(await isEnabled('DESIGN_SWITCHER', { flags: readFlags({}), db })).toBe(true);
    expect(await listAuditEvents(db, { action: 'flag.changed', targetId: 'BIOMETRICS_ENABLED' })).toHaveLength(1);
  });
});
