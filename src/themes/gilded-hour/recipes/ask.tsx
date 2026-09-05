import { ROUTES } from '@/domain/routes';
import type { AskProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, labelForRoute } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Button, Form, content } = kit;
const { PageHead, SearchResults, FaqList } = content;

/** Ask Us: search on the axis, the FAQ as a ruled column, the concierge slot as an empty plaque. */
export const GildedAskPage: ContentRecipe<AskProps> = ({ faq, search, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.ask.eyebrow} title={CONTENT_COPY.ask.title} lede={CONTENT_COPY.ask.lede} />

    <Section id="search" number={1} labelledBy="search-title">
      <SectionHeading level={2} id="search-title" title={CONTENT_COPY.ask.search} />
      <form className="gh-form gh-form--search" method="get" action={ROUTES.ask} role="search">
        <Form.Field id="ask-q" label={CONTENT_COPY.ask.searchLabel} hint={`For example: ${CONTENT_COPY.ask.searchHint}`}>
          <Form.Input id="ask-q" name="q" type="search" defaultValue={search?.query ?? ''} minLength={2} maxLength={200} aria-describedby="ask-q-hint" />
        </Form.Field>
        <p className="gh-form__actions">
          <Button type="submit" variant="primary">
            {CONTENT_COPY.ask.searchButton}
          </Button>
        </p>
      </form>
      {search ? <SearchResults search={search} /> : null}
    </Section>

    <Section id="faq" number={2} ground="alt" labelledBy="faq-title">
      <SectionHeading level={2} id="faq-title" title={CONTENT_COPY.ask.faq} />
      <FaqList entries={faq.entries} labelFor={labelForRoute} />
    </Section>

    <Section id="concierge" number={3} labelledBy="concierge-title">
      <SectionHeading level={2} id="concierge-title" title={CONTENT_COPY.ask.concierge} />
      <div className="gh-slot" id="concierge-slot" data-slot="concierge">
        <Prose>
          <p>{CONTENT_COPY.ask.conciergeNote}</p>
        </Prose>
      </div>
    </Section>
  </Shell>
);
