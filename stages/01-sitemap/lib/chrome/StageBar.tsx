'use client';

import { useSyncExternalStore } from 'react';
import { STAGES, hubHref, stage, stageHref, type Here, type StageId } from '../pipeline';

const noSubscribe = () => () => {};
const readHere = () => `${window.location.protocol}//${window.location.host}`;

function parse(origin: string): Here | undefined {
  if (!origin) return undefined;
  const [protocol, host] = origin.split('//');
  return { protocol: protocol!, host: host! };
}

/**
 * The strip across the top of every stage: which fidelity this is, the question it answers, and
 * the same URL at every other fidelity, so one page can be walked from map to real in five clicks.
 * Links are worked out from the address the page is viewed at (stages/01-sitemap/lib/pipeline.ts),
 * so the same build links correctly on a dev port, under a path prefix and on its own subdomain.
 */
export function StageBar({ current, path }: { current: StageId; path: string }) {
  // '' on the server and during hydration; the browser's origin after.
  const origin = useSyncExternalStore(noSubscribe, readHere, () => '');
  const here = parse(origin);
  const hub = hubHref(here);
  const self = stage(current);
  return (
    <nav className="st-bar" aria-label="Pipeline stages">
      <div className="st-bar__inner">
        <p className="st-bar__here">
          Stage {self.n} of {STAGES.length}: <strong>{self.name}</strong>
          <span className="st-bar__question">{self.question}</span>
        </p>
        <ol className="st-bar__stages">
          {STAGES.map((s) => {
            const href = stageHref(s.id, path, here);
            return (
              <li key={s.id}>
                <a href={href} aria-current={s.id === current ? 'page' : undefined}>{s.n}. {s.name}</a>
              </li>
            );
          })}
          {hub && (
            <li>
              <a href={hub}>All stages</a>
            </li>
          )}
        </ol>
      </div>
    </nav>
  );
}
