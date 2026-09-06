import { ROUTES } from '@/domain/routes';
import type { AdventuresProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, adventureChips } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, Prose, Link, content } = kit;
const { PageHead, Chips, AdventureList } = content;

/** Our Adventures as a mounting sheet: kraft filter tags, then pressed cards tilted across the page. */
export const ConservatoryAdventuresPage: ContentRecipe<AdventuresProps> = ({ data, active, frame }) => {
  const chips = adventureChips(data, active);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.adventures.eyebrow} title={CONTENT_COPY.adventures.title} lede={CONTENT_COPY.adventures.lede}>
        {chips.length > 1 ? <Chips items={chips} label={CONTENT_COPY.adventures.filter} /> : null}
      </PageHead>
      <Section id="archive" ground="alt">
        <div className="cv-section__full">
          {data.items.length === 0 ? (
            <Prose>
              <p>{CONTENT_COPY.adventures.empty}</p>
            </Prose>
          ) : (
            <AdventureList items={data.items} />
          )}
        </div>
        <div className="cv-section__text">
          <Prose>
            <p className="cv-muted">
              {data.total} {data.total === 1 ? 'adventure' : 'adventures'} shared so far. {CONTENT_COPY.adventures.borrow} <Link href={ROUTES.share}>Share an Adventure</Link>.
            </p>
          </Prose>
        </div>
      </Section>
    </Shell>
  );
};
