import type { HomeData, HomeSection } from '@/themes/types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Hero, Section, SectionHeading, Prose, Button, Text } = kit;

/**
 * Home as a herbarium sheet: prose in the left column, each section's link hung beside it as a
 * kraft tag, no numerals, washes and fern rules for rhythm.
 */
function Sheet({ section, index }: { section: HomeSection; index: number }) {
  const washes: NonNullable<Parameters<typeof Section>[0]['ground']>[] = ['default', 'alt', 'default', 'wash', 'default'];
  const ground = section.act === 'now' ? 'wash' : section.act === 'thanks' ? 'inverse' : washes[index % washes.length];
  const headingId = `${section.id}-title`;
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
      {section.link ? (
        <p className="cv-section__hang">
          <a className="cv-tag cv-tag--hang" href={section.link.href}>
            <span>{section.link.label}</span>
          </a>
        </p>
      ) : null}
    </Section>
  );
}

export function ConservatoryHomePage(data: HomeData) {
  return (
    <Shell frame={data} banner={<PreviewBanner lifecycle={data.lifecycle} />}>
      <Hero content={data.content} site={data.site} state={data.lifecycle.state} />
      {data.lifecycle.mode === 'explore' ? (
        <Section id="welcome" labelledBy="welcome-title">
          <SectionHeading level={2} id="welcome-title" title="Rooted in love. Surrounded by peace. Filled with happiness." />
          <Prose>
            <p>We’re so happy you’re here! We believe life’s greatest joys are found in the people we love, the moments we share, and the memories we make along the way.</p>
            <p>We hope our wedding is a reflection of these things and a chance to slow down, be present, and celebrate the happiness that comes from being together. We’re so grateful to have you in our lives.</p>
            <p>With love,<br />Sara &amp; Tyler</p>
            <p><Button href="/sign-in?next=%2Fguests" variant="secondary">Sign in for your guest experience</Button></p>
          </Prose>
        </Section>
      ) : null}
      {data.content.sections.map((s, i) => (
        <Sheet key={s.id} section={s} index={i} />
      ))}
    </Shell>
  );
}
