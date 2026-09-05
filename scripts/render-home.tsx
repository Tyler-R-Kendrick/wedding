/**
 * Design-review harness: renders Home for every theme × lifecycle state to static HTML with the
 * compiled stylesheet inlined, so reviewers can screenshot states that need an admin preview in
 * the running app. Not part of the build.
 *
 *   node --import tsx scripts/render-home.tsx [--out .impeccable/review/html] [--states TEASER,RSVP_OPEN]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { LIFECYCLE_MODE, LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { SEED_SITE } from '@/db/seed/seed';
import { countdownView } from '@/domain/lifecycle/countdown';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { navFor } from '@/domain/lifecycle/nav';
import { getTheme } from '@/themes';
import { THEME_IDS } from '@/themes/registry';
import { homeContent } from '@/themes/shared/home-content';
import type { HomeData, ThemeId } from '@/themes/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const OUT = path.resolve(ROOT, opt('out', '.impeccable/review/html'));
const STATES = opt('states', LIFECYCLE_STATES.join(',')).split(',') as LifecycleState[];
const NOW = new Date();

const cssSource = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
const compiled = await postcss([tailwind({ base: ROOT })]).process(cssSource, { from: path.join(ROOT, 'src/app/globals.css') });
const site = toSiteFacts({ ...SEED_SITE });

function data(theme: ThemeId, state: LifecycleState): HomeData {
  return {
    theme,
    site,
    lifecycle: { state, mode: LIFECYCLE_MODE[state], persistedState: state, preview: null, suggested: 'RSVP_OPEN', publishedAt: null, note: null },
    countdown: countdownView(NOW),
    nav: navFor(state, { venue: site.venue, currentPath: '/' }),
    switcherEnabled: false, // the switcher needs the app router; the harness renders the shell without it
    content: homeContent(site, state),
  };
}

mkdirSync(OUT, { recursive: true });
for (const theme of THEME_IDS) {
  for (const state of STATES) {
    const markup = renderToStaticMarkup(getTheme(theme).recipes.home(data(theme, state)));
    const html = `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home · ${theme} · ${state}</title><style>${compiled.css}</style></head><body>${markup}</body></html>`;
    const file = path.join(OUT, `home-${theme}-${state}.html`);
    writeFileSync(file, html);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
}
