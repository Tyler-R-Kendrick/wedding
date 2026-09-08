import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import { unreadyGatedFlags, withoutUnready } from '@/capabilities/readiness';
import { defineCapability, type AnyCapability } from '@/contracts/capability';
import { readFlags } from '@/contracts/flags';
import { ok } from '@/contracts/result';
import { toolsFor, allAiTools } from '@/ai/router';

/**
 * Level 15, brief item 5. Readiness resolution used to live in the WebMCP manifest route alone;
 * `exposure.ai` never asked, so the concierge would have been offered a capability whose legal
 * switch is off and then refused by `invoke` with `feature_disabled`. Both surfaces now share
 * `@/capabilities/readiness`.
 *
 * Inert against what ships today (no READINESS_GATED capability is ai- or webmcp-exposed), so it
 * is tested with a synthetic descriptor — the point is the day one of them is.
 */
const gated = defineCapability({
  name: 'gated_read',
  title: 'Gated',
  description: 'A readiness-gated read.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  flag: 'BIOMETRICS_ENABLED',
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input: z.object({}).optional(),
  output: z.object({ x: z.number() }),
  handler: async () => ok({ data: { x: 1 }, sources: [] }),
} as AnyCapability);

const plain = defineCapability({ ...gated, name: 'plain_read', flag: undefined } as AnyCapability);

const reg = new CapabilityRegistryImpl();
reg.registerAll([gated, plain]);
const flagsOn = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on' });

describe('readiness-aware derived lists', () => {
  it('counts a gated flag as unready when the switch is off, and fails closed with no service', async () => {
    expect([...(await unreadyGatedFlags(flagsOn, async () => false))]).toEqual(['BIOMETRICS_ENABLED']);
    expect([...(await unreadyGatedFlags(flagsOn, undefined))]).toEqual(['BIOMETRICS_ENABLED']);
    expect([...(await unreadyGatedFlags(flagsOn, async () => true))]).toEqual([]);
    // A flag that is off in the environment is already excluded by the flag filter: never asked about.
    let asked = 0;
    expect([...(await unreadyGatedFlags(readFlags({}), async () => { asked++; return false; }))]).toEqual([]);
    expect(asked).toBe(0);
  });

  it('hides a gated capability from the concierge tool list when its switch is off', async () => {
    const unready = await unreadyGatedFlags(flagsOn, async () => false);
    // Without the readiness answer the env flag alone lists it — this is the old behaviour.
    expect(toolsFor({ kind: 'anonymous' }, flagsOn, reg).map((t) => t.descriptor.name)).toEqual(['gated_read', 'plain_read']);
    expect(toolsFor({ kind: 'anonymous' }, flagsOn, reg, unready).map((t) => t.descriptor.name)).toEqual(['plain_read']);
    // The denial-explanation list must agree, or the concierge would name a tool it cannot see.
    expect(allAiTools(flagsOn, reg, unready).map((c) => c.name)).toEqual(['plain_read']);
  });

  it('withoutUnready leaves ungated capabilities alone and copies rather than mutates', () => {
    const all = reg.list({ exposure: 'ai', flags: flagsOn });
    expect(withoutUnready(all, undefined).map((c) => c.name)).toEqual(['gated_read', 'plain_read']);
    expect(withoutUnready(all, new Set()).map((c) => c.name)).toEqual(['gated_read', 'plain_read']);
    expect(all.map((c) => c.name)).toEqual(['gated_read', 'plain_read']);
  });
});
