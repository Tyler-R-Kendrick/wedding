'use client';

import { useState } from 'react';

export interface BaselineFrame {
  design: string;
  name: string;
  src: string;
}

/**
 * A captured page, shown at this stage in a frame of its own under the stage bar: the real site's
 * stylesheets lay it out in their own viewport, so it holds exactly as production does at every
 * width. Stage 4 passes one frame per captured design and gets a picker between them.
 */
export function BaselineView({ stage, title, frames, source, capturedAt, captured }: { stage: string; title: string; frames: BaselineFrame[]; source: string; capturedAt: string; captured: string }) {
  const [design, setDesign] = useState(frames[0]!.design);
  const frame = frames.find((f) => f.design === design) ?? frames[0]!;
  return (
    <main id="main" className="bl-view">
      <p className="bl-meta">
        <span>
          Baseline: <code>{captured}</code> as {source} served it on {capturedAt}.
        </span>
        {frames.length > 1 && (
          <label className="bl-design">
            Design{' '}
            <select value={design} onChange={(e) => setDesign(e.target.value)}>
              {frames.map((f) => (
                <option key={f.design} value={f.design}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </p>
      <iframe className="bl-frame" src={frame.src} title={`${title}, at the ${stage} stage`} />
    </main>
  );
}
