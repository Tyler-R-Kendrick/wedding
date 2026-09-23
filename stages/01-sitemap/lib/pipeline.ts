/**
 * The five fidelities. Each stage is its own project (own package, dev server, tests, build and
 * deployment) and imports the one before it, so a change upstream reaches every stage downstream
 * on its next build. The real app is stage 5 and lives at the repo root.
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

/**
 * Where each stage is deployed. Set per deployment (Vercel project env); unset falls back to the
 * local dev port so `npm run stages:dev` links the stages to each other with no configuration.
 * Each read is a literal `process.env.NEXT_PUBLIC_…` so Next can inline it into the browser bundle.
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

export function stage(id: StageId): Stage {
  return STAGES.find((s) => s.id === id)!;
}

export function stageUrl(id: StageId, path = '/'): string {
  const base = (configured(id) || `http://localhost:${stage(id).devPort}`).replace(/\/$/, '');
  return `${base}${path}`;
}
