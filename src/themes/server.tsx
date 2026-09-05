import 'server-only';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getCountdown, getLifecycleView, getSiteFacts, navFor, type LifecycleOptions } from '@/domain/lifecycle';
import { getFlags } from '@/lib/flags';
import { getTheme } from './index';
import { isThemeId } from './registry';
import { resolveTheme, THEME_COOKIE } from './resolve';
import { THEME_HEADER } from './routes';
import { homeContent } from './shared/home-content';
import type { HomeData, PageFrame, ThemeId } from './types';

/**
 * Dynamic routes read the theme the proxy resolved (x-theme request header: query already applied),
 * falling back to the cookie. Static routes get the theme from `[theme]` params instead.
 */
export async function getRequestTheme(): Promise<ThemeId> {
  const h = await headers();
  const fromProxy = h.get(THEME_HEADER);
  if (isThemeId(fromProxy)) return fromProxy;
  const jar = await cookies();
  return resolveTheme({ cookie: jar.get(THEME_COOKIE)?.value }).theme;
}

export interface FrameInput {
  theme: ThemeId;
  currentPath: string;
  lifecycle?: LifecycleOptions;
}

/** Everything a recipe needs besides its own content: facts, lifecycle, countdown, nav, switcher. */
export async function buildPageFrame(input: FrameInput): Promise<PageFrame> {
  const [site, lifecycle, countdown] = await Promise.all([getSiteFacts(), getLifecycleView(input.lifecycle), getCountdown()]);
  const claimed = input.lifecycle?.principal?.kind === 'guest';
  const nav = navFor(lifecycle.state, { currentPath: input.currentPath, venue: site.venue, claimed });
  return { theme: input.theme, site, lifecycle, countdown, nav, switcherEnabled: getFlags().DESIGN_SWITCHER };
}

export async function renderHome(input: Omit<FrameInput, 'currentPath'>): Promise<ReactNode> {
  const frame = await buildPageFrame({ ...input, currentPath: '/' });
  const data: HomeData = { ...frame, content: homeContent(frame.site, frame.lifecycle.state) };
  return getTheme(input.theme).recipes.home(data);
}
