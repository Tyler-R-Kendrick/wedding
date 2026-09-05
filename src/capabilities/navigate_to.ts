import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { isInternalRoute } from './routes';

const input = z.object({
  /** Internal path such as "/travel". External URLs are rejected; use an `external` capability for handoffs. */
  route: z.string().min(1).max(200),
  /** Optional element id / anchor to highlight after navigating. */
  highlight: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
});
const output = z.object({ route: z.string(), highlight: z.string().optional() });

export const navigateTo = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'navigate_to',
  title: 'Go to a page',
  description:
    'Navigate to a page on this wedding site by its internal path (for example "/travel" or "/rsvp"). ' +
    'Use it when a guest asks where something is. It only opens pages on this site, never external links, ' +
    'and it changes nothing.',
  kind: 'navigate',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 500,
  async handler(_ctx, { route, highlight }) {
    const trimmed = route.trim();
    const clean = trimmed.replace(/\/+$/, '') || '/';
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('..') || !isInternalRoute(clean)) {
      return err(new CapabilityError('validation', 'That page is not part of this site.', { issues: [{ path: 'route', message: 'unknown route' }] }));
    }
    return ok({ data: highlight ? { route: clean, highlight } : { route: clean }, sources: [] });
  },
});
