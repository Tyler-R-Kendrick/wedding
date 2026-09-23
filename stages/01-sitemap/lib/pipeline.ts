/**
 * The five fidelities. Each stage is its own project (own package, dev server, tests and build)
 * and imports the one before it, so a change upstream reaches every stage downstream on its next
 * build. The real app is stage 5 and lives at the repo root.
 */
export type StageId = 'sitemap' | 'wireframe' | 'skeleton' | 'placeholder' | 'real';

export interface Stage {
  id: StageId;
  n: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** The question this stage exists to answer. Settle it here, not later. */
  question: string;
  dir: string;
  pkg: string;
  devPort: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'sitemap', n: 1, name: 'Sitemap', question: 'Which pages exist, who are they for, and when do they appear?', dir: 'stages/01-sitemap', pkg: '@wedding/sitemap', devPort: 3101 },
  { id: 'wireframe', n: 2, name: 'Wireframe', question: 'What is on each page, and in what order?', dir: 'stages/02-wireframe', pkg: '@wedding/wireframe', devPort: 3102 },
  { id: 'skeleton', n: 3, name: 'Skeleton', question: 'Can you click through every flow, and does the layout hold at every width?', dir: 'stages/03-skeleton', pkg: '@wedding/skeleton', devPort: 3103 },
  { id: 'placeholder', n: 4, name: 'Placeholder', question: 'How does each design carry the structure, before any real content?', dir: 'stages/04-placeholder', pkg: '@wedding/placeholder', devPort: 3104 },
  { id: 'real', n: 5, name: 'Real', question: 'Is every word and image true, and is it ready for guests?', dir: '.', pkg: 'wedding', devPort: 3000 },
];

/** The stages that are built by this pipeline (the real app is deployed on its own). */
export const PIPELINE_STAGES = STAGES.filter((s) => s.id !== 'real');

export function stage(id: StageId): Stage {
  return STAGES.find((s) => s.id === id)!;
}

/** This build's path prefix: `/sitemap` when one host serves every stage, '' otherwise. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A path within this stage, for the few links that do not go through next/link. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * An explicit URL for a stage. Needed only for what the address cannot tell: where the real
 * app lives when the dev host is not `dev.<its domain>`. Each read is a literal
 * `process.env.NEXT_PUBLIC_…` so Next can inline it into the browser bundle.
 */
function configured(id: StageId): string | undefined {
  switch (id) {
    case 'sitemap': return process.env.NEXT_PUBLIC_STAGE_URL_SITEMAP;
    case 'wireframe': return process.env.NEXT_PUBLIC_STAGE_URL_WIREFRAME;
    case 'skeleton': return process.env.NEXT_PUBLIC_STAGE_URL_SKELETON;
    case 'placeholder': return process.env.NEXT_PUBLIC_STAGE_URL_PLACEHOLDER;
    case 'real': return process.env.NEXT_PUBLIC_STAGE_URL_REAL;
  }
}

/** Where the page is being viewed, as the browser sees it. Absent while rendering on the server. */
export interface Here {
  protocol: string;
  host: string;
}

const STAGE_HOST = /^(sitemap|wireframe|skeleton|placeholder|dev)\.(.+)$/;

/**
 * Splits a dev-host address: `sitemap.dev.example.com` → the dev host `dev.example.com`. The
 * first label names the stage (or is `dev`, the hub), and everything after it is shared.
 */
export function devHostOf(host: string): string | null {
  const m = host.match(STAGE_HOST);
  if (!m) return null;
  return m[1] === 'dev' ? host : m[2]!.startsWith('dev.') ? m[2]! : null;
}

/**
 * The URL of `path` at another stage, worked out from where this page is being viewed, so the
 * stages need no configuration to link to each other. The wedding app hosts every stage
 * (src/lib/stage-hosting.ts), so "real" is always the app itself:
 *
 *   hosts   sitemap.dev.kendrick.wedding  → https://wireframe.dev.kendrick.wedding/rsvp
 *           (real: https://kendrick.wedding/rsvp, the dev host without its `dev.`)
 *   paths   <preview>/sitemap/rsvp        → /wireframe/rsvp, and real is /rsvp, on the same host
 *   ports   localhost:3101                → http://localhost:3102/rsvp (`npm run stages:dev`)
 */
export function stageHref(target: StageId, path: string, here?: Here): string {
  const explicit = configured(target);
  if (explicit) return `${explicit.replace(/\/$/, '')}${path}`;

  const devHost = here ? devHostOf(here.host) : null;
  if (here && devHost) {
    const host = target === 'real' ? devHost.replace(/^dev\./, '') : `${target}.${devHost}`;
    return `${here.protocol}//${host}${path}`;
  }
  if (BASE_PATH) return target === 'real' ? path : `/${target}${path}`;
  return `http://localhost:${stage(target).devPort}${path}`;
}

/** The hub: every stage, and every page's progress through them. Null on bare dev ports. */
export function hubHref(here?: Here): string | null {
  const devHost = here ? devHostOf(here.host) : null;
  if (here && devHost) return `${here.protocol}//${devHost}/`;
  return BASE_PATH ? '/stages' : null;
}
