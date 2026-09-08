import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { PROVIDER_KINDS } from '@/contracts/providers';
import { ok } from '@/contracts/result';
import { describeProviders, getProvider } from '@/providers/registry';
import { appServices } from '../context';

const input = z
  .object({
    /**
     * Call each provider's own `health()`. Off by default: for a live adapter that is a real network
     * call, and this page is otherwise a pure inventory read that can be opened safely at any time.
     */
    probe: z.boolean().optional(),
  })
  .optional();

const output = z.object({
  db: z.object({ driver: z.string(), vectorAvailable: z.boolean() }),
  providers: z.array(
    z.object({
      kind: z.enum(PROVIDER_KINDS),
      name: z.string(),
      mode: z.enum(['mock', 'sandbox', 'live', 'deep-link', 'unavailable']),
      config: z.object({ ok: z.boolean(), missing: z.array(z.string()), warnings: z.array(z.string()) }),
      capabilities: z.array(z.object({ name: z.string(), supported: z.boolean() })),
      health: z.object({ status: z.enum(['up', 'degraded', 'down', 'unconfigured', 'unknown']), checkedAt: z.string().nullable(), latencyMs: z.number().int().nullable(), detail: z.string().nullable() }).nullable(),
    }),
  ),
  probed: z.boolean(),
  /** Counts for the page's summary line. */
  totals: z.object({ live: z.number().int(), mock: z.number().int(), misconfigured: z.number().int() }),
});
export type ProviderStatusView = z.infer<typeof output>;

const PROBE_TIMEOUT_MS = 4_000;

/**
 * The deployment's integration inventory: which adapter each provider kind resolved to, in which
 * mode, whether its configuration validates, and which operations that instance says it can
 * actually perform.
 *
 * `config.missing` is a list of environment variable NAMES, never values — the same rule
 * `/api/health` follows. Nothing in this capability reads a secret.
 */
export const adminProviderStatus = defineCapability<z.infer<typeof input>, ProviderStatusView>({
  name: 'admin_provider_status',
  title: 'Providers',
  description: 'Every external-provider kind with the adapter it resolved to, its mode (mock, sandbox, live, deep-link, unavailable), whether its configuration validates, which operations it supports, and optionally a live health probe. Reports the names of missing environment variables, never their values. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const statuses = describeProviders({ db });
    const probe = i?.probe === true;

    const health = await Promise.all(
      statuses.map(async (s) => {
        if (!probe || s.mode === 'unavailable') return null;
        const started = Date.now();
        try {
          const result = await Promise.race([
            getProvider(s.kind, { db }).health(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('health check timed out')), PROBE_TIMEOUT_MS)),
          ]);
          return { status: result.status, checkedAt: result.checkedAt, latencyMs: result.latencyMs ?? Date.now() - started, detail: result.detail ?? null };
        } catch (e) {
          return { status: 'unknown' as const, checkedAt: ctx.now.toISOString(), latencyMs: Date.now() - started, detail: e instanceof Error ? e.message.slice(0, 200) : 'probe failed' };
        }
      }),
    );

    return ok({
      data: {
        db: { driver: db.driver, vectorAvailable: db.vectorAvailable },
        providers: statuses.map((s, idx) => ({
          kind: s.kind,
          name: s.name,
          mode: s.mode,
          config: s.config,
          capabilities: Object.entries(s.capabilities).map(([name, supported]) => ({ name, supported })).sort((a, b) => a.name.localeCompare(b.name)),
          health: health[idx] ?? null,
        })),
        probed: probe,
        totals: {
          live: statuses.filter((s) => s.mode === 'live' || s.mode === 'sandbox').length,
          mock: statuses.filter((s) => s.mode === 'mock').length,
          misconfigured: statuses.filter((s) => !s.config.ok).length,
        },
      },
      sources: [],
    });
  },
});
