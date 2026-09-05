'use server';

import { cookies, headers } from 'next/headers';
import { createCapabilityContext, invoke, navigateTo } from '@/capabilities';
import { env } from '@/lib/env';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';
import { THEME_COOKIE, themeCookieOptions } from '@/themes/resolve';
import type { ThemeId } from '@/themes/types';

export interface SetThemeResult {
  ok: boolean;
  theme?: ThemeId;
  message?: string;
}

/**
 * The switcher's server action: validates the choice through the `navigate_to` capability (no
 * business logic here) and stores it as a device cookie. Same-origin server action, never a
 * custom fetch; nothing about the guest's identity is involved.
 */
export async function setThemeAction(formData: FormData): Promise<SetThemeResult> {
  const theme = String(formData.get('theme') ?? '');
  const h = await headers();
  const principal = await getPrincipal(new Request('http://localhost/switcher', { headers: h }));
  const ctx = await createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui' });
  const result = await invoke(navigateTo, ctx, { route: '/', theme });
  if (!result.ok) return { ok: false, message: result.error.message };
  const chosen = result.value.data.theme;
  if (!chosen) return { ok: false, message: 'That design is not available.' };
  const jar = await cookies();
  jar.set(THEME_COOKIE, chosen, themeCookieOptions(env.isProduction));
  return { ok: true, theme: chosen };
}
