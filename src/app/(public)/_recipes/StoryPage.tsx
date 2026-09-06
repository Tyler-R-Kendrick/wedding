import Link from 'next/link';
import { Paragraphs } from '@/components/provenance';
import type { StoryPageData } from '@/capabilities/get_story';
import { ROUTES } from '@/domain/routes';
import { DraftBadge, PageIntro, Provenance, Section, Shell } from './kit';

export function StoryPage({ data }: { data: StoryPageData }) {
  return (
    <Shell current={ROUTES.story}>
      <PageIntro eyebrow="Our Story" title={data.title} lede="How we met, what this is, and where it is going. Short on purpose; the long version lives in Our Adventures." />
      {data.sections.map((s, i) => (
        <Section key={s.id} id={s.slug} number={String(i + 1).padStart(2, '0')} title={s.title}>
          <div className="wp-prose">
            <DraftBadge placeholder={s.placeholder} />
            <Paragraphs blocks={s.paragraphs} />
            <Provenance provenance={s.provenance} />
          </div>
        </Section>
      ))}
      <Section id="next" title="Keep going">
        <p className="wp-prose">
          <Link href={ROUTES.adventures}>Wander through our adventures →</Link>
        </p>
      </Section>
    </Shell>
  );
}
