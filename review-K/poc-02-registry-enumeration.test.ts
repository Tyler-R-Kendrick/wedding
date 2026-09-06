/**
 * FINDING 2 — the bridge is an oracle for the capability registry. Three distinguishable answers
 * let an unauthenticated caller tell "no such capability" from "exists but hidden from WebMCP"
 * from "exists and needs a session/entitlement".
 *
 * src/webmcp/server/invoke.ts:30   -> not_found "That action is not available."
 * src/capabilities/invoke.ts:80    -> not_found "That action is not available here."   <-- differs
 * src/policy/entitlements.ts:34-35 -> unauthenticated (401) / forbidden (403)
 *
 * docs/architecture/webmcp.md, threat model row "An agent enumerating the registry":
 *   "Unknown names, malformed names and hidden capabilities all answer `not_found` with the same
 *    body."  That claim is false; this test shows the bodies differ.
 *
 * The existing e2e (tests/e2e/webmcp.spec.ts, "unknown tools do not leak the registry") compares
 * `does_not_exist` against `NotSnakeCase` — two names that take the SAME branch — so it passes
 * while the oracle is wide open.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-02-registry-enumeration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { as, invoke, jsonOf } from './helpers';

describe('FINDING 2: registry enumeration through the bridge', () => {
  it('a hidden capability answers differently from a name that does not exist', async () => {
    const unknown = await jsonOf(await invoke('does_not_exist_at_all', { input: {} }));
    const hidden = await jsonOf(await invoke('webmcp_test_hidden', { input: {} })); // exposure.webmcp === false

    expect(unknown.status).toBe(404);
    expect(hidden.status).toBe(404);
    // The documented invariant: identical bodies. They are not.
    expect(hidden.body, 'a hidden capability must be indistinguishable from a missing one').toEqual(unknown.body);
  });

  it('lets an anonymous attacker classify every guessed name into four buckets', async () => {
    const classify = async (name: string, headers: Record<string, string> = {}) => {
      const { status, body } = await jsonOf(await invoke(name, { input: {} }, headers));
      return `${status}:${(body.error as { message?: string } | undefined)?.message ?? 'ok'}`;
    };

    const buckets = {
      absent: await classify('no_such_capability_here'),
      hiddenFromWebmcp: await classify('webmcp_test_hidden'),
      needsSignIn: await classify('webmcp_test_guest_read'),
      needsEntitlement: await classify('webmcp_test_admin_read', as('guest')),
    };

    // Every bucket is a different string => the registry is fully probeable by name.
    expect(new Set(Object.values(buckets)).size, JSON.stringify(buckets, null, 2)).toBe(1);
  });
});
