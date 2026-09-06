import type { HomeData, HomeSection } from '@/themes/types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Hero, Section, SectionHeading, Prose, Card, Button, Stat, Timeline, MapHandoff, Text } = kit;

/**
 * Home as a herbarium sheet: prose in the left column, one pressed card per section mounted in the
 * right column (tilted, overlapping the wash above), no numerals, washes and fern rules for rhythm.
 */
function Sheet({ section, index, data }: { section: HomeSection; index: number; data: HomeData }) {
  const washes: NonNullable<Parameters<typeof Section>[0]['ground']>[] = ['default', 'alt', 'default', 'wash', 'default'];
  const ground = section.act === 'now' ? 'wash' : section.act === 'thanks' ? 'inverse' : washes[index % washes.length];
  const headingId = `${section.id}-title`;
  const hasMount = !!(section.facts?.length || section.timeline || section.map);
  return (
    <Section id={section.id} ground={ground} labelledBy={headingId}>
      <div className="cv-section__text">
        <SectionHeading level={2} id={headingId} title={section.title} />
        <Prose lead={index === 0}>
          <p>
            <Text copy={section.body} />
          </p>
        </Prose>
      </div>
      {!hasMount && section.link ? (
        <p className="cv-section__hang">
          <a className="cv-tag cv-tag--hang" href={section.link.href}>
            <span>{section.link.label}</span>
          </a>
        </p>
      ) : null}
      {hasMount ? (
        <div className="cv-section__mount">
          <Card label={section.label} featured index={index} headingLevel={3} title={section.timeline ? section.title : undefined}>
            {section.facts?.length ? (
              <dl className="cv-stats">
                {section.facts.map((f) => (
                  <Stat key={f.label} {...f} />
                ))}
              </dl>
            ) : null}
            {section.timeline ? <Timeline events={section.timeline} timezone={data.site.date.timezone} label={section.title} nowId={data.lifecycle.state === 'WEDDING_DAY' ? section.timeline[0]?.id : null} /> : null}
            {section.map ? <MapHandoff venue={data.site.venue} /> : null}
            {section.link ? (
              <p className="cv-card__link">
                <Button variant={section.link.variant ?? 'primary'} href={section.link.href} provider={section.link.provider}>
                  {section.link.label}
                </Button>
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}
    </Section>
  );
}

export function ConservatoryHomePage(data: HomeData) {
  return (
    <Shell frame={data} banner={<PreviewBanner lifecycle={data.lifecycle} />}>
      <Hero content={data.content} site={data.site} countdown={data.countdown} state={data.lifecycle.state} />
      {data.content.sections.map((s, i) => (
        <Sheet key={s.id} section={s} index={i} data={data} />
      ))}
    </Shell>
  );
}
