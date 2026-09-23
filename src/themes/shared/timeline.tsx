import Link from 'next/link';
import { Paragraphs } from '@/components/provenance';
import type { StorySectionView, TimelineMomentView } from '@/domain/content/views';
import { formatPartialDate } from './format';

/**
 * The #anchor each timeline station answers to on /our-story. A station's slug is its anchor, its DOM
 * id and the route the concierge cites (`/our-story#starved-rock`). Seeded content is checked for
 * clashes, but a station typed in /admin/content is not, so every theme resolves a clash the same way:
 * chapters and the terminal keep their anchors and a colliding station takes a numeric suffix.
 */
export function timelineAnchors(sections: readonly StorySectionView[], moments: readonly TimelineMomentView[]): Map<string, string> {
  const used = new Set(['the-loop', ...sections.map((s) => s.slug)]);
  const out = new Map<string, string>();
  for (const m of moments) {
    let id = m.slug;
    for (let n = 2; used.has(id); n++) id = `${m.slug}-${n}`;
    used.add(id);
    out.set(m.id, id);
  }
  return out;
}

export interface TimelineStopsClasses {
  list?: string;
  item?: string;
  title?: string;
  meta?: string;
  prose?: string;
}

/**
 * The stations as a plain ordered list, for the designs that do not ride the line (the two earlier
 * proposals and the fallback recipe). It exists so that every station the concierge can cite is an
 * anchor on /our-story whichever design is showing.
 */
export function TimelineStops({ sections, moments, classes = {} }: { sections: readonly StorySectionView[]; moments: readonly TimelineMomentView[]; classes?: TimelineStopsClasses }) {
  if (!moments.length) return null;
  const anchors = timelineAnchors(sections, moments);
  return (
    <ol className={classes.list} aria-label="Along the way">
      {moments.map((m) => {
        const when = formatPartialDate(m.occurredOn);
        return (
          <li key={m.id} id={anchors.get(m.id)} className={classes.item}>
            <h3 className={classes.title}>{m.title}</h3>
            {when || m.locationLabel ? (
              <p className={classes.meta}>
                {when ? <time dateTime={m.occurredOn}>{when}</time> : null}
                {when && m.locationLabel ? ' · ' : null}
                {m.locationLabel ?? null}
              </p>
            ) : null}
            <div className={classes.prose}>
              <Paragraphs blocks={[m.note]} />
            </div>
            {m.adventureRoute ? (
              <p>
                <Link className="link-block" href={m.adventureRoute}>
                  Read the memory
                </Link>
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
