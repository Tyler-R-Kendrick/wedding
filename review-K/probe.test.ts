/**
 * Scratch probe used while reviewing. Not a finding by itself — it dumps the shapes the real
 * proof-of-concept tests assert on, to review-K/probe-output.json.
 *
 * Run: cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts review-K/probe.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GET as MANIFEST } from '@/app/api/webmcp/manifest/route';
import { POST as INVOKE } from '@/app/api/webmcp/invoke/[name]/route';

const SECRET = 'review-k-test-auth-secret-0123456789';
const SAME_ORIGIN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } as const;
const as = (kind: string) => ({ 'x-test-principal': kind, 'x-test-auth': SECRET });

let ipCounter = 0;
const ip = () => ({ 'x-forwarded-for': `10.9.0.${++ipCounter % 250}` });

const invoke = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  INVOKE(
    new Request(`http://localhost:3000/api/webmcp/invoke/${name}`, {
      method: 'POST',
      headers: { ...SAME_ORIGIN, ...ip(), ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );

const manifest = (headers: Record<string, string> = {}) =>
  MANIFEST(new Request('http://localhost:3000/api/webmcp/manifest', { headers: { ...ip(), ...headers } }));

describe('probe', () => {
  it('dumps the manifest and a range of invoke shapes', async () => {
    const out: Record<string, unknown> = {};
    const anon = await (await manifest()).json();
    out.anonTools = anon.data.tools.map((t: { name: string }) => t.name);
    out.anonManifest = anon.data.tools;

    const guest = await (await manifest(as('guest'))).json();
    out.guestKind = guest.data.principal.kind;
    out.guestTools = guest.data.tools.map((t: { name: string }) => t.name);

    const admin = await (await manifest(as('admin'))).json();
    out.adminTools = admin.data.tools.map((t: { name: string }) => t.name);

    const probes: Record<string, unknown> = {};
    for (const [label, name, headers] of [
      ['unknown-name', 'does_not_exist', {}],
      ['malformed-name', 'NotSnakeCase', {}],
      ['exists-but-not-webmcp-exposed', 'webmcp_test_hidden', {}],
      ['exists-guest-only-called-anon', 'webmcp_test_guest_read', {}],
      ['exists-admin-only-called-guest', 'webmcp_test_admin_read', as('guest')],
      ['public', 'site_status', {}],
    ] as [string, string, Record<string, string>][]) {
      const r = await invoke(name, { input: {} }, headers);
      probes[label] = { name, status: r.status, body: await r.json() };
    }
    out.probes = probes;

    writeFileSync('review-K/probe-output.json', JSON.stringify(out, null, 2));
    expect(true).toBe(true);
  });
});
