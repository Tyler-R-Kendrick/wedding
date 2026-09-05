import Link from 'next/link';
import type { ReactNode } from 'react';
import { Text } from '@/components/provenance';
import type { FaqPageData } from '@/capabilities/get_faq';
import type { StaticSearchData } from '@/capabilities/search_wedding_information_static';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import { DraftBadge, PageIntro, Section, Shell } from './kit';

export interface AskRecipeProps {
  faq: FaqPageData;
  search?: StaticSearchData;
  /** Swarm J's concierge island, passed in by the page so this recipe stays theme-agnostic. */
  concierge?: ReactNode;
}

export function AskPage({ faq, search, concierge }: AskRecipeProps) {
  return (
    <Shell current={ROUTES.ask}>
      <PageIntro eyebrow="Ask Us" title="Questions, answered" lede="The essentials first. Anything we have not decided yet says so, instead of guessing." />

      <Section id="search" number="01" title="Search the site">
        <form className="wp-form" method="get" action={ROUTES.ask} role="search">
          <div className="wp-field">
            <label htmlFor="ask-q">What are you looking for?</label>
            <input id="ask-q" name="q" type="search" defaultValue={search?.query ?? ''} minLength={2} maxLength={200} placeholder="valet, kids, Cindy's, dress code" />
          </div>
          <div>
            <button className="wp-button" type="submit">
              Search
            </button>
          </div>
        </form>
        {search ? (
          <div id="search-results" aria-live="polite">
            {search.results.length === 0 ? (
              <p className="wp-prose">
                We don&rsquo;t have that information yet. The questions below cover the basics; <Link href="#contact">reach us</Link> for anything else.
              </p>
            ) : (
              <ul className="wp-list" aria-label="Search results">
                {search.results.map((r) => (
                  <li key={r.id} className="wp-card">
                    <h3>
                      <Link href={r.route}>{r.title}</Link>
                    </h3>
                    <p>{r.snippet}</p>
                    <p className="wp-muted">
                      {humanize(r.kind)} · checked <time dateTime={r.verifiedAt}>{r.verifiedAt.slice(0, 10)}</time>
                      {r.caveat ? ` · ${r.caveat}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Section>

      <Section id="faq" number="02" title="Frequently asked">
        <div className="wp-faq wp-prose">
          {faq.entries.map((e) => (
            <article key={e.id} id={e.slug} aria-labelledby={`faq-${e.slug}`}>
              <h2 id={`faq-${e.slug}`}>{e.question}</h2>
              <DraftBadge placeholder={e.placeholder} />
              <Text block={e.answer} />
              {e.route ? (
                <p>
                  <Link href={e.route}>See {labelFor(e.route)} →</Link>
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </Section>

      <Section id="concierge" number="03" title="Ask a question">
        <div className="wp-slot" id="concierge-slot" data-slot="concierge">
          {concierge ?? <p className="wp-prose">The concierge is on its way. It will answer only from what this site knows, with a source for every fact, and it will say when it does not know.</p>}
        </div>
      </Section>
    </Shell>
  );
}

function labelFor(route: string): string {
  const base = route.split('#')[0] ?? route;
  const known: Record<string, string> = {
    [ROUTES.wedding]: 'The Wedding',
    [ROUTES.exploreCaa]: 'Explore CAA',
    [ROUTES.photos]: 'Photos & Video',
    [ROUTES.travel]: 'Travel & Stay',
    [ROUTES.gifts]: 'Gifts',
    '/rsvp': 'RSVP',
  };
  return known[base] ?? 'the page';
}
