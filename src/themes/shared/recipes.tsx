import type { ArchivePageData, DashboardPageData, DetailPageData, FormPageData, GalleryPageData, PageFrame, StoryPageData, ThemeComponentKit, ThemeRecipes } from '@/themes/types';
import { PreviewBanner } from './PreviewBanner';

export interface GenericRecipeOptions {
  /** Number chapters and detail sections (only real sequences). */
  numbered: boolean;
  /** Mount cards in the theme's aside/mounting area (Conservatory) rather than on the axis. */
  mounted: boolean;
}

/**
 * Generic page recipes other swarms compose (StoryPage, ArchivePage, DetailPage, FormPage,
 * DashboardPage, GalleryPage). Structure comes from the theme's kit: Gilded Hour sets sections on
 * one axis with numerals; Conservatory hangs cards in the mounting area with washes.
 */
export function createGenericRecipes(kit: ThemeComponentKit, opts: GenericRecipeOptions): Omit<ThemeRecipes, 'home'> {
  const { Shell, Section, SectionHeading, Prose, Card, ImageFrame, Gallery, Button, Timeline, Stat, MapHandoff, Text, Badge } = kit;
  const banner = (frame: PageFrame) => <PreviewBanner lifecycle={frame.lifecycle} />;

  const facts = (items: DetailPageData['sections'][number]['facts']) =>
    items && items.length ? (
      <dl className="kit-stats">
        {items.map((f) => (
          <Stat key={f.label} {...f} />
        ))}
      </dl>
    ) : null;

  return {
    story: (d: StoryPageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="intro">
          <SectionHeading level={1} title={d.title} lede={d.intro ? <Text copy={d.intro} /> : undefined} />
        </Section>
        {d.chapters.map((c, i) => (
          <Section key={c.id} id={c.id} number={opts.numbered ? i + 1 : undefined} ground={!opts.numbered && i % 2 === 1 ? 'alt' : 'default'}>
            <SectionHeading level={2} title={c.title} />
            {c.media ? <ImageFrame {...c.media} /> : null}
            <Prose lead={i === 0}>
              <p>
                <Text copy={c.body} />
              </p>
            </Prose>
          </Section>
        ))}
      </Shell>
    ),

    archive: (d: ArchivePageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="intro">
          <SectionHeading level={1} title={d.title} lede={d.intro ? <Text copy={d.intro} /> : undefined} />
        </Section>
        <Section id="items" ground={opts.mounted ? 'alt' : 'default'}>
          {d.items.length === 0 ? (
            <Prose>
              <p>{d.emptyMessage ?? 'Nothing here yet.'}</p>
            </Prose>
          ) : (
            <ul className="kit-archive">
              {d.items.map((item, i) => (
                <li key={item.id}>
                  <Card title={item.title} headingLevel={2} label={item.label} featured={opts.mounted} index={i} media={item.media ? <ImageFrame {...item.media} /> : undefined} actions={item.href ? <Button variant="ghost" href={item.href}>Open</Button> : undefined}>
                    <p>
                      <Text copy={item.summary} />
                    </p>
                    {item.tags?.length ? (
                      <p className="kit-tags">
                        {item.tags.map((t) => (
                          <Badge key={t} status="info">
                            {t}
                          </Badge>
                        ))}
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Shell>
    ),

    detail: (d: DetailPageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="intro">
          <SectionHeading level={1} title={d.title} lede={d.intro ? <Text copy={d.intro} /> : undefined} />
          {d.actions?.length ? (
            <p className="kit-actions">
              {d.actions.map((a) => (
                <Button key={a.href} variant={a.variant ?? 'secondary'} href={a.href} provider={a.provider}>
                  {a.label}
                </Button>
              ))}
            </p>
          ) : null}
        </Section>
        {d.sections.map((s, i) => (
          <Section key={s.id} id={s.id} number={opts.numbered ? i + 1 : undefined} ground={!opts.numbered && i % 2 === 1 ? 'alt' : 'default'}>
            <SectionHeading level={2} title={s.heading} />
            <Prose>
              <p>
                <Text copy={s.body} />
              </p>
            </Prose>
            {facts(s.facts)}
            {s.timeline ? <Timeline events={s.timeline} timezone={d.site.date.timezone} label={s.heading} /> : null}
            {s.map ? <MapHandoff venue={d.site.venue} /> : null}
          </Section>
        ))}
      </Shell>
    ),

    form: (d: FormPageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="form" ground={opts.mounted ? 'alt' : 'default'}>
          <SectionHeading level={1} title={d.title} lede={d.intro ? <Text copy={d.intro} /> : undefined} />
          <div className="kit-form-layout">
            <div>{d.form}</div>
            {d.summary ? (
              <Card title="What you are sending" headingLevel={2} featured={opts.mounted}>
                {d.summary}
              </Card>
            ) : null}
          </div>
        </Section>
      </Shell>
    ),

    dashboard: (d: DashboardPageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="greeting" ground="wash">
          <SectionHeading level={1} title={d.greeting} lede={d.status} />
        </Section>
        <Section id="panels">
          <ul className="kit-archive">
            {d.panels.map((p, i) => (
              <li key={p.id}>
                <Card
                  id={p.id}
                  title={p.title}
                  headingLevel={2}
                  index={i}
                  actions={
                    p.actions?.length ? (
                      <>
                        {p.actions.map((a) => (
                          <Button key={a.href} variant={a.variant ?? 'secondary'} href={a.href} provider={a.provider}>
                            {a.label}
                          </Button>
                        ))}
                      </>
                    ) : undefined
                  }
                >
                  {p.body}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      </Shell>
    ),

    gallery: (d: GalleryPageData) => (
      <Shell frame={d} banner={banner(d)}>
        <Section id="intro">
          <SectionHeading level={1} title={d.title} lede={d.intro ? <Text copy={d.intro} /> : undefined} />
          {d.upload ? (
            <p className="kit-actions">
              <Button variant={d.upload.variant ?? 'primary'} href={d.upload.href}>
                {d.upload.label}
              </Button>
            </p>
          ) : null}
        </Section>
        <Section id="gallery">
          <Gallery items={d.items} label={d.title} />
          <Prose>
            <p className="kit-rights">{d.rightsNote}</p>
          </Prose>
        </Section>
      </Shell>
    ),
  };
}
