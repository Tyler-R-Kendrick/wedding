import { ROUTES } from '@/domain/routes';
import type { AskProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, labelForRoute } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Button, Form, Card, content } = kit;
const { PageHead, SearchResults, FaqList } = content;

/** Ask Us on the sheet: the search on a sky wash with results mounted beside it, the FAQ down the left, and the concierge at prose width in its own section below (a
 * kraft-tagged jar in the mount column while it is still switched off). */
export const ConservatoryAskPage: ContentRecipe<AskProps> = ({ faq, search, concierge, frame }) => (
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
      {concierge ? null : (
        <div className="cv-section__mount">
          <Card label={CONTENT_COPY.ask.conciergeTagOff} featured index={2} headingLevel={2} title={CONTENT_COPY.ask.concierge} id="concierge-card">
            <div className="cv-slot" data-slot="concierge">
              <Prose>
                <p>{CONTENT_COPY.ask.conciergeNote}</p>
              </Prose>
            </div>
          </Card>
        </div>
      )}
    </Section>

    {/* Its own section, at prose width, NOT the mount column beside the FAQ.
        A conversation is prose: the mount is the sheet's narrow specimen column, and it gave the
        transcript a 258px paragraph at 1440 — about 30 characters, against the 55-72 this design's
        DESIGN.md asks for, and NARROWER at 1440 than at 768. The card also nested three frames
        (card outline, kraft jar, panel border) around text, which its own card rule forbids. The
        kraft-tagged jar is still the right expression for the empty state above, where it holds one
        short line and promises something; it is the wrong container for the thing itself. */}
    {concierge ? (
      <Section id="concierge" labelledBy="concierge-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="concierge-title" title={CONTENT_COPY.ask.concierge} />
          <div className="cv-slot cv-slot--open" id="concierge-slot" data-slot="concierge">
            {concierge}
          </div>
        </div>
      </Section>
    ) : null}
  </Shell>
);
