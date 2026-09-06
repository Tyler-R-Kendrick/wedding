import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { invoke } from '@/capabilities/invoke';
import { navigateTo } from '@/capabilities/navigate_to';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import { isInternalRoute } from '@/capabilities/routes';
import { defineCapability, type CapabilityContext } from '@/contracts/capability';
import { readFlags } from '@/contracts/flags';
import { ok } from '@/contracts/result';
import { MemoryAuditSink } from '@/lib/audit';

const base = (): CapabilityContext => ({
  principal: { kind: 'anonymous' },
  requestId: 'r',
  now: new Date(),
  flags: readFlags({}),
  audit: new MemoryAuditSink(),
  inputTrust: 'TRUSTED_WEDDING',
  services: {},
});

describe('navigate_to', () => {
  it('accepts allowlisted internal routes and normalises trailing slashes', async () => {
    const r = await invoke(navigateTo, base(), { route: '/travel/' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.data).toEqual({ route: '/travel' });
    const h = await invoke(navigateTo, base(), { route: '/our-adventures/starved-rock', highlight: 'first-i-love-you' });
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.value.data).toEqual({ route: '/our-adventures/starved-rock', highlight: 'first-i-love-you' });
  });

  it('rejects external, protocol-relative, traversal, and unknown routes', async () => {
    for (const route of ['https://evil.example', '//evil.example', '/travel/../admin', '/admin', '/our-adventures/Bad Slug', 'travel']) {
      const r = await invoke(navigateTo, base(), { route });
      expect(r.ok, route).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation');
    }
    expect(isInternalRoute('/')).toBe(true);
    expect(isInternalRoute('/photos/abc-123')).toBe(true);
  });
});

describe('capability registry', () => {
  const reg = new CapabilityRegistryImpl();
  const read = defineCapability<unknown, { x: number }>({
    name: 'reg_read', title: 't', description: 'd', kind: 'read', auth: 'anonymous', requires: [],
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    exposure: { ui: true, ai: true, webmcp: false }, input: z.unknown(), output: z.object({ x: z.number() }),
    handler: async () => ok({ data: { x: 1 }, sources: [] }),
  });
  const adminOnly = defineCapability<unknown, { x: number }>({ ...read, name: 'reg_admin', auth: 'admin', flag: 'AI_CONCIERGE', exposure: { ui: true, ai: false, webmcp: false } });
  reg.registerAll([read, adminOnly]);

  it('filters by exposure, principal and flags', () => {
    expect(reg.names()).toEqual(['reg_admin', 'reg_read']);
    expect(reg.list({ exposure: 'ai' }).map((c) => c.name)).toEqual(['reg_read']);
    expect(reg.list({ principal: { kind: 'anonymous' } }).map((c) => c.name)).toEqual(['reg_read']);
    expect(reg.list({ flags: readFlags({ FLAG_AI_CONCIERGE: 'off' }) }).map((c) => c.name)).toEqual(['reg_read']);
    expect(reg.list({ principal: { kind: 'system', component: 't' } })).toHaveLength(2);
  });

  it('refuses duplicate names but tolerates re-registering the same descriptor', () => {
    expect(() => reg.register(read)).not.toThrow();
    expect(() => reg.register({ ...read })).toThrow(/already registered/);
    expect(() => defineCapability({ ...read, name: 'Bad Name' })).toThrow();
    expect(() => defineCapability({ ...read, kind: 'transaction' })).toThrow(/stepUp/);
  });
});
