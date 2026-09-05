import Link from 'next/link';
import { Text } from '@/components/provenance';
import type { AdventuresPageData } from '@/capabilities/list_adventures';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import { ChipLinks, DraftBadge, PageIntro, Shell } from './kit';

export interface AdventuresRecipeProps {
  data: AdventuresPageData;
  active: { tag?: string; season?: string };
}

export function AdventuresPage({ data, active }: AdventuresRecipeProps) {
  const chips = [
    { href: ROUTES.adventures, label: 'All', active: !active.tag && !active.season },
    ...data.tags.map((t) => ({ href: `${ROUTES.adventures}?tag=${t}`, label: humanize(t), active: active.tag === t })),
    ...data.seasons.map((s) => ({ href: `${ROUTES.adventures}?season=${s}`, label: humanize(s), active: active.season === s })),
  ];
  return (
    <Shell current={ROUTES.adventures}>
      <PageIntro eyebrow="Our Adventures" title="The places that shaped us" lede="A growing archive of the experiences and memories behind this wedding. Some are still being written." />
      {chips.length > 1 ? <ChipLinks items={chips} label="Filter adventures" /> : null}
      {data.items.length === 0 ? (
        <p className="wp-prose">Nothing matches that filter yet. More adventures are being written.</p>
      ) : (
        <ul className="wp-grid" aria-label="Adventures">
          {data.items.map((a) => (
            <li key={a.id}>
              <article className="wp-card" data-adventure={a.slug}>
                <h2>
                  <Link href={a.href}>{a.title}</Link>
                </h2>
                <DraftBadge placeholder={a.placeholder} />
                <p>
                  <Text block={a.summary} inline />
                </p>
                <dl className="wp-meta">
                  {a.placeName ? (
                    <>
                      <dt>Where</dt>
                      <dd>{a.placeName}</dd>
                    </>
                  ) : null}
                  {a.dateLabel ? (
                    <>
                      <dt>When</dt>
                      <dd>
                        <Text block={a.dateLabel} inline />
                      </dd>
                    </>
                  ) : null}
                  {a.tags.length ? (
                    <>
                      <dt>Motifs</dt>
                      <dd>{a.tags.map(humanize).join(', ')}</dd>
                    </>
                  ) : null}
                </dl>
              </article>
            </li>
          ))}
        </ul>
      )}
      <p className="wp-prose wp-muted">
        {data.total} {data.total === 1 ? 'adventure' : 'adventures'} shared so far. Borrow a few for your weekend on <Link href={ROUTES.share}>Share an Adventure</Link>.
      </p>
    </Shell>
  );
}
