import type { HomeData, HomeSection } from '@/themes/types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Hero, Section, SectionHeading, Prose, Button, Stat, Timeline, MapHandoff, Text } = kit;

/** Home as five numbered acts on one axis: the hero is a monument, each act opens the same way. */
function Act({ section, index, data }: { section: HomeSection; index: number; data: HomeData }) {
  const grounds: NonNullable<Parameters<typeof Section>[0]['ground']>[] = ['default', 'alt', 'default', 'wash', 'default', 'alt'];
  const ground = section.act === 'now' ? 'wash' : section.act === 'thanks' ? 'inverse' : grounds[index % grounds.length];
  const headingId = `${section.id}-title`;
  return (
    <Section id={section.id} number={index + 1} ground={ground} labelledBy={headingId}>
      <SectionHeading level={2} id={headingId} eyebrow={section.label} title={section.title} />
      <Prose>
        <p>
          <Text copy={section.body} />
        </p>
      </Prose>
      {section.facts?.length ? (
        <dl className="gh-stats">
          {section.facts.map((f) => (
            <Stat key={f.label} {...f} />
          ))}
        </dl>
      ) : null}
      {section.timeline ? <Timeline events={section.timeline} timezone={data.site.date.timezone} label={section.title} nowId={data.lifecycle.state === 'WEDDING_DAY' ? section.timeline[0]?.id : null} /> : null}
      {section.map ? <MapHandoff venue={data.site.venue} /> : null}
      {section.link ? (
        <p className="gh-section__action">
          <Button variant={section.link.variant ?? 'secondary'} href={section.link.href} provider={section.link.provider}>
            {section.link.label}
          </Button>
        </p>
      ) : null}
    </Section>
  );
}

export function GildedHomePage(data: HomeData) {
  return (
    <Shell frame={data} banner={<PreviewBanner lifecycle={data.lifecycle} />}>
      <Hero content={data.content} site={data.site} countdown={data.countdown} state={data.lifecycle.state} />
      {data.content.sections.map((s, i) => (
        <Act key={s.id} section={s} index={i} data={data} />
      ))}
    </Shell>
  );
}
