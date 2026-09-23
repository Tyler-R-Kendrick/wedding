/**
 * What each pipeline stage is built from. A stage reads its own directory and every stage above
 * it, so a change cascades DOWN the pipeline and never up: editing the sitemap rebuilds all four
 * stages; editing the skeleton kit rebuilds stages 3 and 4 and leaves 1 and 2 alone.
 *
 * Used by `changed.mjs` (Vercel's ignoreCommand, per stage project) and by the CI workflow's
 * path filters, so "what redeploys" and "what re-tests" are the same answer.
 */
const SHARED = ['package.json', 'package-lock.json', 'scripts/stages/', 'stages/tsconfig.stage.json'];

export const INPUTS = {
  sitemap: [...SHARED, 'stages/01-sitemap/'],
  wireframe: [...SHARED, 'stages/01-sitemap/', 'stages/02-wireframe/'],
  skeleton: [...SHARED, 'stages/01-sitemap/', 'stages/02-wireframe/', 'stages/03-skeleton/'],
  // Stage 4 also wears the real designs: a token change in any DESIGN.md reaches it.
  placeholder: [...SHARED, 'stages/01-sitemap/', 'stages/02-wireframe/', 'stages/03-skeleton/', 'stages/04-placeholder/', 'src/themes/', 'public/fonts/', 'public/assets/art/'],
};

export function affects(stage, files) {
  const inputs = INPUTS[stage];
  if (!inputs) throw new Error(`unknown stage "${stage}"`);
  return files.some((f) => inputs.some((i) => (i.endsWith('/') ? f.startsWith(i) : f === i)));
}
