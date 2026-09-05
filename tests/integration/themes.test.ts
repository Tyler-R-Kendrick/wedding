import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke, navigateTo, siteStatus } from '@/capabilities';
import type { AdminPrincipal } from '@/contracts/principal';
import { verifyPreviewToken } from '@/domain/lifecycle/preview';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { getDb } from '@/db/client';
import { listAuditEvents } from '@/lib/audit';

const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth' as never, adminId: 'adm-1' as never, roles: new Set(['owner']), entitlements: new Set(['admin_lifecycle']), authenticatedAt: '2026-09-05T12:00:00Z', sessionId: 's' };

describe('site_status (theme + lifecycle extensions)', () => {
  it('returns countdown, navigation, the active theme and the switcher flag', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-theme-1', view: { theme: 'conservatory' } });
    const r = await invoke(siteStatus, ctx, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.theme).toMatchObject({ active: 'conservatory', switcherEnabled: true });
    expect(r.value.data.theme.available.map((t) => t.id)).toEqual(['gilded-hour', 'conservatory']);
    expect(r.value.data.countdown.days).toBeGreaterThan(0);
    expect(r.value.data.navigation.primary.length).toBeGreaterThan(0);
    expect(r.value.data.lifecycle).toMatchObject({ state: 'TEASER', preview: false, persistedState: 'TEASER' });
    expect(r.value.data.wedding).toMatchObject({ dateLong: 'Saturday, July 17, 2027' });
    expect(r.value.data.wedding.mapsUrl).toContain('google.com/maps');
  });

  it('falls back to the default theme for unknown view themes and ignores previews for non-admins', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-theme-2', view: { theme: 'neon', lifecycle: 'RSVP_OPEN' } });
    const r = await invoke(siteStatus, ctx, {});
    expect(r.ok && r.value.data.theme.active).toBe('gilded-hour');
    expect(r.ok && r.value.data.lifecycle.state).toBe('TEASER');
    expect(r.ok && r.value.data.lifecycle.preview).toBe(false);
  });
});

describe('navigate_to (theme + preview extensions)', () => {
  it('validates the theme id', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-nav-t1' });
    const ok = await invoke(navigateTo, ctx, { route: '/', theme: 'conservatory' });
    expect(ok.ok && ok.value.data).toEqual({ route: '/', theme: 'conservatory' });
    const bad = await invoke(navigateTo, ctx, { route: '/', theme: 'neon' });
    expect(!bad.ok && bad.error.code).toBe('validation');
  });

  it('issues lifecycle previews for admins only and audits them', async () => {
    const anon = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-nav-p1' });
    const denied = await invoke(navigateTo, anon, { route: '/', lifecycle: 'RSVP_OPEN' });
    expect(!denied.ok && denied.error.code).toBe('unauthenticated');

    const ctx = await createCapabilityContext({ principal: admin, requestId: 'req-nav-p2' });
    const r = await invoke(navigateTo, ctx, { route: '/', lifecycle: 'RSVP_OPEN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.preview?.state).toBe('RSVP_OPEN');
    const verified = verifyPreviewToken(r.value.data.preview!.token, getPreviewSecret(), new Date());
    expect(verified.ok && verified.value.state).toBe('RSVP_OPEN');

    const status = await invoke(siteStatus, await createCapabilityContext({ principal: admin, requestId: 'req-nav-p3', view: { lifecycle: r.value.data.preview!.token } }), {});
    expect(status.ok && status.value.data.lifecycle).toMatchObject({ state: 'RSVP_OPEN', preview: true, persistedState: 'TEASER' });

    const db = await getDb();
    expect(await listAuditEvents(db, { action: 'lifecycle.previewed', requestId: 'req-nav-p2' })).toHaveLength(1);
  });
});
