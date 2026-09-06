import { ROUTES } from '@/domain/routes';
import type { AdventuresProps, ContentRecipe } from '@/themes/content-types';
import { CONTENT_COPY, adventureChips } from '@/themes/shared/content';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, Prose, Link, content } = kit;
const { PageHead, Chips, AdventureList } = content;

/** Our Adventures as a ledger: one ruled row per adventure, numbered down the axis, filters as plaques above. */
export const GildedAdventuresPage: ContentRecipe<AdventuresProps> = ({ data, active, frame }) => {
  const chips = adventureChips(data, active);
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead eyebrow={CONTENT_COPY.adventures.eyebrow} title={CONTENT_COPY.adventures.title} lede={CONTENT_COPY.adventures.lede}>
        {chips.length > 1 ? <Chips items={chips} label={CONTENT_COPY.adventures.filter} /> : null}
      </PageHead>
      <Section id="archive">
        {data.items.length === 0 ? (
          <Prose>
            <p>{CONTENT_COPY.adventures.empty}</p>
          </Prose>
        ) : (
          <AdventureList items={data.items} />
        )}
        <Prose>
          <p className="gh-muted gh-ledger__foot">
            {data.total} {data.total === 1 ? 'adventure' : 'adventures'} shared so far. {CONTENT_COPY.adventures.borrow} <Link href={ROUTES.share}>Share an Adventure</Link>.
          </p>
        </Prose>
      </Section>
    </Shell>
  );
};
