import { StageBar } from '@wedding/sitemap/chrome';
import { baselineFor, DESIGN_NAMES, designsFor, frameName, type FrameStage } from './baseline';
import { BaselineView } from './BaselineView';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A stage page for a captured page: the stage bar, then the real page redrawn at this stage.
 * `null` when the page has no baseline yet (it is not built, or not captured): the stage then draws
 * it from the sitemap instead, and says so. Server component; reads the baseline at build.
 */
export function BaselinePage({ stage, pageId, url }: { stage: FrameStage; pageId: string; url: string }) {
  const meta = baselineFor(pageId);
  if (!meta) return null;
  const designs = stage === 'placeholder' ? designsFor(pageId) : designsFor(pageId).slice(0, 1);
  const frames = designs.map((d) => ({ design: d, name: DESIGN_NAMES[d], src: `${BASE}/baseline/${frameName(pageId, d)}` }));
  const source = meta.principal ? `the app's test server, signed in as the fixture ${meta.principal},` : meta.source.replace(/^https?:\/\//, '');
  return (
    <div className="bl-screen">
      <StageBar current={stage} path={url} />
      <BaselineView stage={stage} title={meta.title} frames={frames} source={source} capturedAt={meta.capturedAt} captured={meta.finalUrl || meta.url} />
    </div>
  );
}

/** Said above a page drawn from the sitemap, so nobody mistakes it for the real page's layout. */
export function NoBaselineNote() {
  return (
    <p className="bl-none" role="note">
      No baseline for this page yet: it is drawn from its sitemap row, not from the real site. Run <code>npm run stages:capture</code> once the page is built.
    </p>
  );
}
