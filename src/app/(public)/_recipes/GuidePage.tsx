import Link from 'next/link';
import { Text } from '@/components/provenance';
import type { FindAdventuresData } from '@/capabilities/find_adventures';
import type { ItinerariesData } from '@/capabilities/list_itineraries';
import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import { ChipLinks, DraftBadge, PageIntro, Provenance, RecommendationCardView, Section, Shell, StopLine } from './kit';

export interface GuideRecipeProps {
  itineraries: ItinerariesData;
  recommendations: FindAdventuresData;
  activeBucket?: string;
  plan?: { minutes: number; kids: boolean; interest?: string; result: FindAdventuresData['plan'] };
}

const MINUTE_OPTIONS = [45, 120, 180, 300] as const;
const INTEREST_OPTIONS = ['architecture', 'walk', 'food', 'drink', 'outdoors', 'inside-caa'] as const;

export function GuidePage({ itineraries, recommendations, activeBucket, plan }: GuideRecipeProps) {
  const chips = [
    { href: ROUTES.share, label: 'All', active: !activeBucket },
    ...itineraries.buckets.map((b) => ({ href: `${ROUTES.share}?bucket=${b}`, label: humanize(b), active: activeBucket === b })),
  ];
  const byCategory = new Map<string, FindAdventuresData['items']>();
  for (const r of recommendations.items) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);

  return (
    <Shell current={ROUTES.share}>
      <PageIntro
        eyebrow="Share an Adventure"
        title="Borrow a few of ours"
        lede="Every card has the practical part first: what, where, how long, and how to get there. Open the memory behind it if you want to know why it matters to us."
      />

      <Section id="itineraries" number="01" title="Pick your time">
        <ChipLinks items={chips} label="Itineraries by time and interest" />
        <ul className="wp-list" aria-label="Itineraries">
          {itineraries.itineraries.map((it) => (
            <li key={it.id} id={it.slug}>
              <article className="wp-card" data-itinerary={it.slug}>
                <h3>{it.title}</h3>
                <DraftBadge draft={it.draft} placeholder={it.placeholder} />
                {it.intro ? (
                  <p>
                    <Text block={it.intro} inline />
                  </p>
                ) : null}
                {it.stops.length ? (
                  <ol className="wp-bullets">
                    {it.stops.map((s, i) => (
                      <StopLine key={`${it.id}-${i}`} recommendation={s.recommendation} minutes={s.minutes} note={s.note} />
                    ))}
                  </ol>
                ) : null}
                {it.stops.length ? <p className="wp-muted">About {formatMinutes(it.totalMinutes)} in total.</p> : null}
                <Provenance provenance={it.provenance} />
              </article>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="plan" number="02" title="Plan around the time you have">
        <form className="wp-form" method="get" action={ROUTES.share}>
          <div className="wp-field">
            <label htmlFor="plan-minutes">How much time do you have?</label>
            <select id="plan-minutes" name="minutes" defaultValue={plan?.minutes ?? 120}>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {formatMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="wp-field">
            <label htmlFor="plan-interest">What are you in the mood for?</label>
            <select id="plan-interest" name="interest" defaultValue={plan?.interest ?? ''}>
              <option value="">Anything</option>
              {INTEREST_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {humanize(i)}
                </option>
              ))}
            </select>
          </div>
          <div className="wp-check">
            <input id="plan-kids" name="kids" type="checkbox" value="1" defaultChecked={plan?.kids ?? false} />
            <label htmlFor="plan-kids">We have kids with us</label>
          </div>
          <div>
            <button className="wp-button" type="submit">
              Suggest a plan
            </button>
          </div>
        </form>
        {plan?.result ? (
          <div className="wp-card" id="plan-result" aria-live="polite">
            <h3>
              A {formatMinutes(plan.minutes)} plan{plan.interest ? ` for ${humanize(plan.interest).toLowerCase()}` : ''}
              {plan.kids ? ', with kids' : ''}
            </h3>
            {plan.result.stops.length ? (
              <ol className="wp-bullets">
                {plan.result.stops.map((s) => (
                  <StopLine key={s.recommendation.id} recommendation={s.recommendation} minutes={s.minutes} />
                ))}
              </ol>
            ) : (
              <p>Nothing fits that combination yet. Try more time or a different mood.</p>
            )}
            {plan.result.stops.length ? <p className="wp-muted">About {formatMinutes(plan.result.totalMinutes)} in total. Everything here is a draft until we have curated it.</p> : null}
          </div>
        ) : null}
      </Section>

      <Section id="recommendations" number="03" title="All the places">
        {[...byCategory.entries()].map(([category, items]) => (
          <section key={category} id={`category-${category}`} aria-labelledby={`category-${category}-title`}>
            <h3 id={`category-${category}-title`}>{humanize(category)}</h3>
            <ul className="wp-grid">
              {items.map((r) => (
                <li key={r.id}>
                  <RecommendationCardView card={r} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="wp-prose wp-muted">
          Hours, menus, and reservation links for the hotel&rsquo;s own places live on <Link href={`${ROUTES.exploreCaa}#outlets`}>Explore CAA</Link>, each with the day we last checked it.
        </p>
      </Section>
    </Shell>
  );
}
