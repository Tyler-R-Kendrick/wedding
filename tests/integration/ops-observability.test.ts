import { describe, expect, it } from 'vitest';
import { adminOpsMetrics, adminProviderStatus } from '@/capabilities/ops';
import { PROVIDER_KINDS } from '@/contracts/providers';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import type { AdminPrincipal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { metrics as metricsTable } from '@/db/schema';
import { expectErr, expectOk, run } from './helpers/swarm-e';

const admin = (entitlements: string[] = ['admin_integrations']): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: 'A' as AuthIdentityId,
  adminId: 'AD-OBS' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements as never),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'obs-session',
});

describe('admin_provider_status', () => {
  it('requires admin_integrations', async () => {
    expect(expectErr(await run(adminProviderStatus, admin(['admin_content']), {})).code).toBe('forbidden');
  });

  it('inventories every provider kind with its mode and detected operations', async () => {
    const d = expectOk(await run(adminProviderStatus, admin(), {})).data;
    expect(d.providers.map((p) => p.kind).sort()).toEqual([...PROVIDER_KINDS].sort());
    expect(d.db.driver).toBe('pglite');
    expect(d.probed).toBe(false);
    expect(d.providers.every((p) => p.health === null)).toBe(true);
    const storage = d.providers.find((p) => p.kind === 'storage')!;
    expect(storage.mode).toBe('mock');
    expect(d.totals.mock).toBeGreaterThan(0);
    // Capability detection: adapters report what they can actually do right now.
    expect(d.providers.some((p) => p.capabilities.length > 0)).toBe(true);
  });

  it('reports the NAMES of missing configuration and never a value', async () => {
    // The single reason this screen is allowed to exist. If any adapter ever returned a value in
    // `missing` or `warnings`, this is where it would surface.
    process.env.OPS_TEST_FAKE_SECRET = 'super-secret-value-nobody-should-see';
    try {
      const d = expectOk(await run(adminProviderStatus, admin(), {})).data;
      const rendered = JSON.stringify(d);
      expect(rendered).not.toContain('super-secret-value-nobody-should-see');
      for (const p of d.providers) {
        for (const name of p.config.missing) {
          // An env var NAME: upper snake case, and not something with a value shape in it.
          expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
      }
    } finally {
      delete process.env.OPS_TEST_FAKE_SECRET;
    }
  });

  it('probes health only when asked', async () => {
    const d = expectOk(await run(adminProviderStatus, admin(), { probe: true })).data;
    expect(d.probed).toBe(true);
    const probed = d.providers.filter((p) => p.health !== null);
    expect(probed.length).toBeGreaterThan(0);
    expect(probed.every((p) => ['up', 'degraded', 'down', 'unconfigured', 'unknown'].includes(p.health!.status))).toBe(true);
  });
});

describe('admin_ops_metrics', () => {
  it('requires admin_integrations', async () => {
    expect(expectErr(await run(adminOpsMetrics, admin(['admin_audit']), {})).code).toBe('forbidden');
  });

  it('rolls up counters and histograms over the window, with percentiles for histograms only', async () => {
    const db = await getDb();
    const now = new Date();
    const rows = [
      ...[1, 1, 1, 1, 1].map(() => ({ name: 'ops_test.counter', kind: 'counter' as const, value: 1, at: now })),
      ...[10, 20, 30, 40, 100].map((v) => ({ name: 'ops_test.histogram', kind: 'histogram' as const, value: v, at: now })),
      // Outside the window: must not be counted.
      { name: 'ops_test.counter', kind: 'counter' as const, value: 1, at: new Date(now.getTime() - 48 * 3_600_000) },
    ];
    await db.insert(metricsTable).values(rows);

    const d = expectOk(await run(adminOpsMetrics, admin(), { windowHours: 24 })).data;
    const counter = d.series.find((s) => s.name === 'ops_test.counter')!;
    expect(counter).toMatchObject({ kind: 'counter', points: 5, sum: 5, p50: null, p95: null });
    const hist = d.series.find((s) => s.name === 'ops_test.histogram')!;
    expect(hist).toMatchObject({ kind: 'histogram', points: 5, max: 100 });
    expect(hist.p50).toBe(30);
    expect(hist.p95).toBeGreaterThanOrEqual(80);

    const wide = expectOk(await run(adminOpsMetrics, admin(), { windowHours: 720 })).data;
    expect(wide.series.find((s) => s.name === 'ops_test.counter')!.points).toBe(6);
  });

  it('says whether this deployment records metrics at all, so an empty table is not read as a quiet week', async () => {
    const d = expectOk(await run(adminOpsMetrics, admin(), {})).data;
    // The test environment sets METRICS_SINK=none (vitest.config.ts), which is exactly the case
    // this field exists for.
    expect(d.sink).toBe('none');
    expect(d.recording).toBe(false);
    expect(d.retentionDays).toBeGreaterThan(0);
  });

  it('counts audit volume for the same window and never invents a cost', async () => {
    const d = expectOk(await run(adminOpsMetrics, admin(), { windowHours: 24 })).data;
    expect(d.audit.total).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/usd|Usd|USD|\$/);
  });
});
