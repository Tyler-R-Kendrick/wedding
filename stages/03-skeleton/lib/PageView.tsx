'use client';

import type { Wireframe } from '@wedding/wireframe';
import { Blocks, StageHint } from './blocks';
import { PageScope } from './content';

/** One sitemap page at skeleton fidelity: its wireframe, rendered by the stage 3 kit. */
export function PageView({ wireframe }: { wireframe: Wireframe }) {
  return (
    <PageScope page={wireframe.page}>
      <main id="main" className="st-main">
        <StageHint />
        <Blocks blocks={wireframe.blocks} />
      </main>
    </PageScope>
  );
}
