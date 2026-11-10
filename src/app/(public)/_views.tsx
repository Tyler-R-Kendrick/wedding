import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import { invoke } from '@/capabilities/invoke';
import { getStory } from '@/capabilities/get_story';
import { listAdventures } from '@/capabilities/list_adventures';
import { showAdventure } from '@/capabilities/show_adventure';
import type { Season } from '@/db/schema/content';
import { publicPageContext, type Reader } from '@/domain/content/page-context';
import { ANONYMOUS } from '@/lib/principal';
import { DEFAULT_THEME, THEME_IDS } from '@/themes/registry';
import { PREVIEW_HEADER } from '@/themes/routes';
import { getRequestTheme, renderHome } from '@/themes/server';
import { publicRecipes } from './_recipes';

/**
 * What each static public route renders, for either reader (`src/themes/routes.ts`). The page under
 * `(public)/` passes `request` and is rendered for whoever asked; its twin under `t/[theme]/` passes
 * `anonymous`, reads no request, and is the copy that is prerendered and cached. One body for both,
 * so the two cannot drift apart in anything but who is reading.
 */

/** Home. With a session it resolves the reader: a guest is sent on to `/guests`, an admin's preview applies. */
export async function HomeView({ reader }: { reader: Reader }): Promise<ReactNode> {
  if (reader === 'anonymous') return renderHome({ theme: DEFAULT_THEME, lifecycle: { principal: ANONYMOUS } });
  const [{ principal }, preview] = [await publicPageContext(), (await headers()).get(PREVIEW_HEADER)];
  return renderHome({ theme: await getRequestTheme(), lifecycle: { principal, ...(preview ? { preview: { value: preview, source: 'query' as const } } : {}) } });
}

export async function StoryView({ reader }: { reader: Reader }) {
  const { ctx } = await publicPageContext(reader);
  const r = await invoke(getStory, ctx, {});
  if (!r.ok) throw new Error(r.error.message);
  const { StoryPage } = publicRecipes(reader);
  return <StoryPage data={r.value.data} />;
}

/** The chips filter by `?tag=` or `?season=`; a request with either is never answered from the prerendered copy. */
export async function AdventuresView({ reader, tag, season }: { reader: Reader; tag?: string; season?: Season }) {
  const { ctx } = await publicPageContext(reader);
  const r = await invoke(listAdventures, ctx, { ...(tag && /^[a-z0-9-]{1,40}$/.test(tag) ? { tag } : {}), ...(season ? { season } : {}) });
  if (!r.ok) throw new Error(r.error.message);
  const { AdventuresPage } = publicRecipes(reader);
  return <AdventuresPage data={r.value.data} active={{ tag, season }} />;
}

/**
 * One lookup per render, shared by the page and its metadata. The tab title used to be the raw URL
 * slug ("starved rock state park"), and whatever someone typed after the slash for an unknown one.
 */
const loadAdventure = cache(async (reader: Reader, slug: string) => {
  const { ctx } = await publicPageContext(reader);
  return invoke(showAdventure, ctx, { slug });
});

export async function adventureMetadata(reader: Reader, slug: string): Promise<Metadata> {
  const r = await loadAdventure(reader, slug);
  const title = r.ok ? r.value.data.title : undefined;
  if (title) return { title };
  // "Not found" only when it is: a failed read (a rate limit, the database) keeps the site's default title.
  return r.ok || r.error.code === 'not_found' || r.error.code === 'validation' ? { title: 'Not found' } : {};
}

export async function AdventureView({ reader, slug }: { reader: Reader; slug: string }) {
  const r = await loadAdventure(reader, slug);
  if (!r.ok) {
    if (r.error.code === 'not_found' || r.error.code === 'validation') notFound();
    throw new Error(r.error.message);
  }
  const { AdventureDetailPage } = publicRecipes(reader);
  return <AdventureDetailPage data={r.value.data} />;
}

/*
 * `generateStaticParams` for the prerendered tree, `t/[theme]/…`. Each page names its own params
 * (the layout names none), because that is the one way a page can say "not at build time": Home and
 * the documents need nothing a build lacks and are always built ahead; the story and the adventures
 * are read from the database, which a build may not be able to reach (CI builds against an empty
 * one). Those are built ahead when it can be read and otherwise on their first visit, then cached
 * the same way, so an unreadable database never fails a build.
 */
export const staticParams = (): { theme: string }[] => THEME_IDS.map((theme) => ({ theme }));

async function adventureSlugsAtBuild(): Promise<string[]> {
  try {
    const { ctx } = await publicPageContext('anonymous');
    const r = await invoke(listAdventures, ctx, {});
    return r.ok ? r.value.data.items.map((a) => a.slug) : [];
  } catch {
    return [];
  }
}

export async function staticParamsWhenReadable(): Promise<{ theme: string }[]> {
  return (await adventureSlugsAtBuild()).length > 0 ? staticParams() : [];
}

/** Every adventure the build can read; one added later is rendered on its first visit. */
export async function adventureStaticParams(): Promise<{ theme: string; slug: string }[]> {
  return (await adventureSlugsAtBuild()).map((slug) => ({ theme: DEFAULT_THEME, slug }));
}
