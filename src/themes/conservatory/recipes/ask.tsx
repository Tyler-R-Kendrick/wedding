import { ROUTES } from '@/domain/routes';
import type { AskProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, labelForRoute } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Button, Form, Card, content } = kit;
const { PageHead, SearchResults, FaqList } = content;

/** Ask Us on the sheet: the search on a sky wash with results mounted beside it, the FAQ down the left, the concierge as a kraft-tagged card. */
export const ConservatoryAskPage: ContentRecipe<AskProps> = ({ faq, search, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.ask.eyebrow} title={CONTENT_COPY.ask.title} lede={CONTENT_COPY.ask.lede} />

    <Section id="search" ground="wash" labelledBy="search-title">
      <div className="cv-section__text">
        <SectionHeading level={2} id="search-title" title={CONTENT_COPY.ask.search} />
        <form className="cv-form cv-form--search" method="get" action={ROUTES.ask} role="search">
          <Form.Field id="ask-q" label={CONTENT_COPY.ask.searchLabel} hint={`For example: ${CONTENT_COPY.ask.searchHint}`}>
            <Form.Input id="ask-q" name="q" type="search" defaultValue={search?.query ?? ''} minLength={2} maxLength={200} aria-describedby="ask-q-hint" />
          </Form.Field>
          <p className="cv-form__actions">
            <Button type="submit" variant="primary">
              {CONTENT_COPY.ask.searchButton}
            </Button>
          </p>
        </form>
      </div>
      {search ? (
        <div className="cv-section__mount cv-section__mount--flat">
          <SearchResults search={search} />
        </div>
      ) : null}
    </Section>

    <Section id="faq" labelledBy="faq-title">
      <div className="cv-section__text">
        <SectionHeading level={2} id="faq-title" title={CONTENT_COPY.ask.faq} />
        <FaqList entries={faq.entries} labelFor={labelForRoute} />
      </div>
      <div className="cv-section__mount">
        <Card label="Soon" featured index={2} headingLevel={2} title={CONTENT_COPY.ask.concierge} id="concierge">
          <div className="cv-slot" id="concierge-slot" data-slot="concierge">
            <Prose>
              <p>{CONTENT_COPY.ask.conciergeNote}</p>
            </Prose>
          </div>
        </Card>
      </div>
    </Section>
  </Shell>
);
