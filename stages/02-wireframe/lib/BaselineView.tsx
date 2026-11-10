/**
 * A captured page, shown at this stage in a frame of its own under the stage bar: the real site's
 * stylesheets lay it out in their own viewport, so it holds exactly as production does at every
 * width.
 */
export function BaselineView({ stage, title, src, source, capturedAt, captured }: { stage: string; title: string; src: string; source: string; capturedAt: string; captured: string }) {
  return (
    <main id="main" className="bl-view">
      <p className="bl-meta">
        <span>
          Baseline: <code>{captured}</code> as {source} served it on {capturedAt}.
        </span>
      </p>
      <iframe className="bl-frame" src={src} title={`${title}, at the ${stage} stage`} />
    </main>
  );
}
