import { STAGES, stage, stageUrl, type StageId } from '../pipeline';

/**
 * The strip across the top of every stage: which fidelity this is, the question it answers, and
 * the same URL at every other fidelity — so one page can be walked from map to real in five clicks.
 */
export function StageBar({ current, path }: { current: StageId; path: string }) {
  const here = stage(current);
  return (
    <nav className="st-bar" aria-label="Pipeline stages">
      <div className="st-bar__inner">
        <p className="st-bar__here">
          Stage {here.n} of {STAGES.length}: <strong>{here.name}</strong>
          <span className="st-bar__question">{here.question}</span>
        </p>
        <ol className="st-bar__stages">
          {STAGES.map((s) => (
            <li key={s.id}>
              <a href={s.id === current ? path : stageUrl(s.id, path)} aria-current={s.id === current ? 'page' : undefined}>
                {s.n}. {s.name}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
