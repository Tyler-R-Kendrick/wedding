import { formatMinutes } from '@/domain/adventures/itineraries';
import { humanize } from '@/domain/content/format';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, GuideProps } from '@/themes/content-types';
import { CONTENT_COPY, INTEREST_OPTIONS, MINUTE_OPTIONS, groupByCategory, itineraryChips, planTitle } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Button, Link, Form, content } = kit;
const { PageHead, Chips, ItineraryCard, StopList, RecommendationCard } = content;

/**
 * Share an Adventure in three acts: 01 itineraries as programmes on the axis, 02 the plan form on a
 * lake wash with its result plaque, 03 every place by category.
 */
export const GildedGuidePage: ContentRecipe<GuideProps> = ({ itineraries, recommendations, activeBucket, plan, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead eyebrow={CONTENT_COPY.guide.eyebrow} title={CONTENT_COPY.guide.title} lede={CONTENT_COPY.guide.lede} />

    <Section id="itineraries" number={1} labelledBy="itineraries-title">
      <SectionHeading level={2} id="itineraries-title" title={CONTENT_COPY.guide.time} />
      <Chips items={itineraryChips(itineraries, activeBucket)} label={CONTENT_COPY.guide.filter} />
      <ul className="gh-grid" aria-label="Itineraries">
        {itineraries.itineraries.map((it, i) => (
          <li key={it.id}>
            <ItineraryCard itinerary={it} index={i} />
          </li>
        ))}
      </ul>
    </Section>

    <Section id="plan" number={2} ground="wash" labelledBy="plan-title">
      <SectionHeading level={2} id="plan-title" title={CONTENT_COPY.guide.plan} />
      <form className="gh-form" method="get" action={ROUTES.share}>
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
        <p className="gh-form__actions">
          <Button type="submit" variant="primary">
            {CONTENT_COPY.guide.suggest}
          </Button>
        </p>
      </form>
      {plan?.result ? (
        <article className="gh-card gh-card--featured gh-plan-result" id="plan-result" aria-live="polite">
          <div className="gh-card__inner">
            <h3 className="gh-card__title">{planTitle(plan)}</h3>
            {plan.result.stops.length ? <StopList stops={plan.result.stops} label="Suggested stops" /> : <p>{CONTENT_COPY.guide.nothing}</p>}
            {plan.result.stops.length ? (
              <p className="gh-muted">
                About {formatMinutes(plan.result.totalMinutes)} in total. {CONTENT_COPY.guide.draftNote}
              </p>
            ) : null}
          </div>
        </article>
      ) : null}
    </Section>

    <Section id="recommendations" number={3} labelledBy="recommendations-title">
      <SectionHeading level={2} id="recommendations-title" title={CONTENT_COPY.guide.all} />
      {groupByCategory(recommendations.items).map(([category, items]) => (
        <section key={category} id={`category-${category}`} className="gh-category" aria-labelledby={`category-${category}-title`}>
          <h3 id={`category-${category}-title`} className="gh-category__title">
            {humanize(category)}
          </h3>
          <ul className="gh-grid">
            {items.map((r) => (
              <li key={r.id}>
                <RecommendationCard card={r} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Prose>
        <p className="gh-muted">
          {CONTENT_COPY.guide.hours} <Link href={`${ROUTES.exploreCaa}#outlets`}>Explore CAA</Link>
          {CONTENT_COPY.guide.hoursTail}
        </p>
      </Prose>
    </Section>
  </Shell>
);
