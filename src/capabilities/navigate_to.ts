import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { err, ok } from '@/contracts/result';
import { mintPreviewToken } from '@/domain/lifecycle/preview';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { requireAdmin } from '@/lib/principal';
import { isThemeId, THEME_IDS } from '@/themes/registry';
import { isInternalRoute } from './routes';

const input = z.object({
  /** Internal path such as "/travel". External URLs are rejected; use an `external` capability for handoffs. */
  route: z.string().min(1).max(200),
  /** Optional element id / anchor to highlight after navigating. */
  highlight: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  /** Optional visual theme to switch to ("gilded-hour" | "conservatory"); the UI stores it as a device cookie. */
  theme: z.string().max(40).optional(),
  /** Admins only: preview the site in another lifecycle state; returns a signed preview token. */
  lifecycle: z.enum(LIFECYCLE_STATES).optional(),
});
const output = z.object({
  route: z.string(),
  highlight: z.string().optional(),
  theme: z.enum(THEME_IDS).optional(),
  preview: z.object({ state: z.enum(LIFECYCLE_STATES), token: z.string(), expiresAt: z.string() }).optional(),
});

export type NavigateToOutput = z.infer<typeof output>;

export const navigateTo = defineCapability<z.infer<typeof input>, NavigateToOutput>({
  name: 'navigate_to',
  title: 'Go to a page',
  description:
    'Navigate to a page on this wedding site by its internal path (for example "/travel" or "/rsvp"). ' +
    'Use it when a guest asks where something is. It only opens pages on this site, never external links, ' +
    'and it changes nothing. It can also switch the visual design ("gilded-hour" or "conservatory") for this device, ' +
    'and, for administrators only, issue a preview of another lifecycle state.',
  kind: 'navigate',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 800,
  async handler(ctx, { route, highlight, theme, lifecycle }) {
    const trimmed = route.trim();
    const clean = trimmed.replace(/\/+$/, '') || '/';
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('..') || !isInternalRoute(clean)) {
      return err(new CapabilityError('validation', 'That page is not part of this site.', { issues: [{ path: 'route', message: 'unknown route' }] }));
    }
    const data: NavigateToOutput = { route: clean };
    if (highlight) data.highlight = highlight;
    if (theme !== undefined) {
      const id = theme.trim().toLowerCase();
      if (!isThemeId(id)) {
        return err(new CapabilityError('validation', 'That design is not available.', { issues: [{ path: 'theme', message: 'unknown theme' }] }));
      }
      data.theme = id;
    }
    if (lifecycle) {
      try {
        requireAdmin(ctx.principal, ['owner', 'planner']);
      } catch (e) {
        return err(CapabilityError.is(e) ? e : new CapabilityError('forbidden', 'You do not have access to that.'));
      }
      const minted = mintPreviewToken(lifecycle, getPreviewSecret(), ctx.now);
      data.preview = { state: lifecycle, token: minted.token, expiresAt: minted.expiresAt };
      await ctx.audit.record({
        actor: { kind: 'admin', adminId: ctx.principal.kind === 'admin' ? ctx.principal.adminId : ('' as never) },
        action: 'lifecycle.previewed',
        target: { type: 'lifecycle', id: 'current' },
        outcome: 'success',
        requestId: ctx.requestId,
        metadata: { state: lifecycle },
      });
    }
    return ok({ data, sources: [] });
  },
});
