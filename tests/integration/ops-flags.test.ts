import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminDisableFlagReadiness, adminFlagStatus } from '@/capabilities/ops';
import { registry } from '@/capabilities';
import { FEATURE_FLAGS, READINESS_GATED } from '@/contracts/flags';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { LEGAL_GATES } from '@/domain/ops';
import { DbAuditSink, listAuditEvents } from '@/lib/audit';
import { invalidateReadinessCache, isReady, setReadiness } from '@/lib/flags';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_lifecycle']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-FLG' as AdminId,
  roles: new Set(['planner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'flag-session',
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });

describe('admin_flag_status', () => {
  it('requires admin_lifecycle', async () => {
    expect(expectErr(await run(adminFlagStatus, admin(['admin_media']), {})).code).toBe('forbidden');
  });

  it('lists every flag with both halves of its gate', async () => {
    const d = expectOk(await run(adminFlagStatus, admin(), {})).data;
    expect(d.flags.map((f) => f.name).sort()).toEqual(Object.keys(FEATURE_FLAGS).sort());
    for (const flag of READINESS_GATED) {
      const view = d.flags.find((f) => f.name === flag)!;
      expect(view.readinessGated).toBe(true);
      expect(view.gate).not.toBeNull();
      expect(view.gate!.preconditionMet).toBe(false);
      expect(view.gate!.backlogIds.length).toBeGreaterThan(0);
      // Off by default and off in effect: that is the shipped state and the test says so out loud.
      expect(view.effective).toBe(false);
    }
    expect(d.flags.find((f) => f.name === 'AI_CONCIERGE')!.readinessGated).toBe(false);
    expect(d.flags.find((f) => f.name === 'AI_CONCIERGE')!.readiness).toBeNull();
  });

  it('reports a recorded justification as present without returning its text', async () => {
    const db = await getDb();
    await setReadiness(db, { flag: 'BIOMETRICS_ENABLED', ready: true, actor: { kind: 'system', component: 'test' }, requestId: 'req-flag-note', audit: new DbAuditSink(db), note: 'ADR-0006 §7 memo 2027-01-04 from counsel' });
    invalidateReadinessCache();
    const d = expectOk(await run(adminFlagStatus, admin(), {})).data;
    const view = d.flags.find((f) => f.name === 'BIOMETRICS_ENABLED')!;
    expect(view.readiness).toBe(true);
    expect(view.hasNote).toBe(true);
    expect(view.updatedBy).toEqual({ kind: 'system', ref: 'test' });
    expect(JSON.stringify(d)).not.toContain('memo 2027-01-04');
  });
});

describe('switching a readiness gate off', () => {
  it('always works, needs no reference, and audits the change', async () => {
    const db = await getDb();
    await setReadiness(db, { flag: 'BIOMETRICS_ENABLED', ready: true, actor: { kind: 'system', component: 'test' }, requestId: 'req-flag-pre', audit: new DbAuditSink(db), note: 'x'.repeat(20) });
    invalidateReadinessCache();
    expect(await isReady('BIOMETRICS_ENABLED', db)).toBe(true);

    // A planner: `admin_lifecycle` but NOT `admin_ai`, so the biometrics-owned off switch is out of
    // reach. Closing a legal gate must not depend on holding the entitlement that owns the feature.
    const r = expectOk(await run(adminDisableFlagReadiness, admin(['admin_lifecycle']), { flag: 'BIOMETRICS_ENABLED' }, { requestId: 'req-flag-off' })).data;
    expect(r).toMatchObject({ readiness: false, effective: false, changed: true });
    invalidateReadinessCache();
    expect(await isReady('BIOMETRICS_ENABLED', db)).toBe(false);
    const rows = await listAuditEvents(db, { action: 'flag.changed', requestId: 'req-flag-off' });
    expect(rows[0]!.metadata).toMatchObject({ readiness: false });
  });

  it('is idempotent in effect: switching an already-off gate off changes nothing and says so', async () => {
    const again = expectOk(await run(adminDisableFlagReadiness, admin(), { flag: 'PRO_MEDIA_AI_PROCESSING' })).data;
    expect(again).toMatchObject({ readiness: false, changed: false });
  });

  it('refuses a flag that has no readiness switch', async () => {
    expect(expectErr(await run(adminDisableFlagReadiness, admin(), { flag: 'AI_CONCIERGE' })).code).toBe('validation');
  });
});

/**
 * The property this level is most at risk of destroying. A previous adversarial review recorded
 * that `PRO_MEDIA_AI_PROCESSING` readiness is "unopenable through the app ... fail-closed in the
 * right direction", and the obvious shape for a feature-flag admin screen — one control that flips
 * any switch — would have ended that in one commit. These fail if it ever does.
 */
describe('no console path can open a legal gate', () => {
  const files = walk('src');
  /**
   * Comments are stripped first. Without that the check reads prose as code: the doc comment on
   * `admin_disable_flag_readiness` explains this very rule and contains the string
   * `ready: true`, which made the scan report its own documentation as a second enable path.
   */
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('setReadiness is called with ready: true in exactly one file, and it is the counsel-gated one', () => {
    const callers = files
      .map((f) => ({ file: f, text: code(readFileSync(f, 'utf8')) }))
      .filter(({ text }) => /setReadiness\s*\(/.test(text) && !/export async function setReadiness/.test(text))
      .map(({ file, text }) => ({ file, readyArgs: [...text.matchAll(/setReadiness\s*\([\s\S]{0,400}?ready:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]) }));

    expect(callers.length).toBeGreaterThan(0);
    for (const c of callers) {
      // No call may pass a variable: `ready: someBoolean` is how "turn it on" arrives by accident.
      expect(c.readyArgs.every((a) => a === 'true' || a === 'false'), `${c.file} passes a non-literal ready:`).toBe(true);
    }
    const enablers = callers.filter((c) => c.readyArgs.includes('true')).map((c) => c.file.replace(/\\/g, '/'));
    expect(enablers).toEqual(['src/capabilities/biometrics/admin_enable_biometric_readiness.ts']);
  });

  it('the one capability that can enable a gate carries every guard, and nothing else claims to enable one', () => {
    const enable = registry.get('admin_enable_biometric_readiness')!;
    expect(enable.stepUp).toBe(true);
    expect(enable.confirmation).toBe('explicit');
    expect(enable.exposure).toEqual({ ui: true, ai: false, webmcp: false });
    expect(enable.requires).toContain('admin_lifecycle');

    const enablingNames = registry
      .list()
      .map((c) => c.name)
      .filter((n) => /enable.*readiness|readiness.*enable|set_.*readiness/.test(n));
    expect(enablingNames).toEqual(['admin_enable_biometric_readiness']);
  });

  it('every readiness-gated flag has a legal gate whose precondition is unmet in source', () => {
    for (const flag of READINESS_GATED) {
      const gate = LEGAL_GATES[flag];
      expect(gate, `${flag} has no LEGAL_GATES entry`).toBeDefined();
      // A literal `false` in source: the only way this becomes true is a person editing the file.
      expect(gate!.preconditionMet).toBe(false);
    }
  });

  it('the status capability states, in its own output, that it cannot switch anything on', async () => {
    const d = expectOk(await run(adminFlagStatus, admin(), {})).data;
    expect(d.enablement.available).toBe(false);
    expect(d.enablement.reason).toMatch(/C-09/);
  });
});
