import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, GuideProps } from '@/themes/content-types';
import { CONTENT_COPY, INTEREST_OPTIONS, MINUTE_OPTIONS, categoryHeading, groupByCategory, guideJumpItems, itineraryChips, planTitle } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Button, Link, Form, content } = kit;
const { PageHead, Chips, ItineraryCard, StopList, RecommendationCard } = content;

/**
 * Share an Adventure on the sheet: itineraries are pressed cards with a vine of stops; the plan form
 * sits on the sky wash with its result mounted beside it; the places follow, one fern rule per category.
 */
export const ConservatoryGuidePage: ContentRecipe<GuideProps> = ({ itineraries, recommendations, activeBucket, plan, frame }) => {
  const groups = groupByCategory(recommendations.items);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.guide.eyebrow} title={CONTENT_COPY.guide.title} lede={CONTENT_COPY.guide.lede}>
        {/* The longest page on the site: without this nothing past the second screen is reachable. */}
        <nav className="cv-jump" aria-label={CONTENT_COPY.guide.jump}>
          <Chips items={guideJumpItems(groups)} label={CONTENT_COPY.guide.jump} />
        </nav>
      </PageHead>

      <Section id="itineraries" labelledBy="itineraries-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="itineraries-title" title={CONTENT_COPY.guide.time} />
          <Chips items={itineraryChips(itineraries, activeBucket)} label={CONTENT_COPY.guide.filter} />
        </div>
        <ul className="cv-section__full cv-mount" aria-label="Itineraries">
          {itineraries.itineraries.map((it, i) => (
            <li key={it.id} className="cv-mount__item">
              <ItineraryCard itinerary={it} index={i} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="plan" ground="wash" labelledBy="plan-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="plan-title" title={CONTENT_COPY.guide.plan} />
          <form className="cv-form" method="get" action={ROUTES.share}>
            <Form.Field id="plan-minutes" label={CONTENT_COPY.guide.minutes}>
              <Form.Select id="plan-minutes" name="minutes" defaultValue={plan?.minutes ?? 120}>
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
              </Form.Select>
            </Form.Field>
            <Form.Field id="plan-interest" label={CONTENT_COPY.guide.mood}>
              <Form.Select id="plan-interest" name="interest" defaultValue={plan?.interest ?? ''}>
                <option value="">Anything</option>
                {INTEREST_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {humanize(i)}
                  </option>
                ))}
              </Form.Select>
            </Form.Field>
            <Form.Checkbox id="plan-kids" name="kids" value="1" label={CONTENT_COPY.guide.kids} defaultChecked={plan?.kids ?? false} />
            <p className="cv-form__actions">
              <Button type="submit" variant="primary">
                {CONTENT_COPY.guide.suggest}
              </Button>
            </p>
          </form>
        </div>
        {plan?.result ? (
          <div className="cv-section__mount">
            <article className="cv-card cv-pressed cv-plan" id="plan-result" data-flower="b" aria-live="polite">
              <span className="cv-specimen">Your plan</span>
              <h3 className="cv-card__title">{planTitle(plan)}</h3>
              <div className="cv-card__body">
                {plan.result.stops.length ? <StopList stops={plan.result.stops} label="Suggested stops" /> : <p>{CONTENT_COPY.guide.nothing}</p>}
                {plan.result.stops.length ? (
                  <p className="cv-muted">
                    About {formatMinutes(plan.result.totalMinutes)} in total. {CONTENT_COPY.guide.draftNote}
                  </p>
                ) : null}
              </div>
            </article>
          </div>
        ) : null}
      </Section>

      <Section id="recommendations" labelledBy="recommendations-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="recommendations-title" title={CONTENT_COPY.guide.all} />
        </div>
        <div className="cv-section__full">
          {groups.map(([category, items]) => (
            <section key={category} id={`category-${category}`} className="cv-category" aria-labelledby={`category-${category}-title`}>
              <h3 id={`category-${category}-title`} className="cv-category__title">
                <span className="cv-specimen cv-specimen--static">{categoryHeading(category, items.length)}</span>
              </h3>
              <ul className="cv-mount">
                {items.map((r) => (
                  <li key={r.id} className="cv-mount__item">
                    {/* h4: a place sits one level below the category that groups it */}
                    <RecommendationCard card={r} headingLevel={4} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Prose>
            <p className="cv-muted">
              {CONTENT_COPY.guide.hours} <Link href={`${ROUTES.exploreCaa}#outlets`}>Explore CAA</Link>
              {CONTENT_COPY.guide.hoursTail}
            </p>
          </Prose>
        </div>
      </Section>
    </Shell>
  );
};
