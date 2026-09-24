import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageForUrl, staticParams } from '@wedding/sitemap';
import { StageBar } from '@wedding/sitemap/chrome';
import { BaselinePage, NoBaselineNote } from '@wedding/wireframe/baseline-page';
import { wireframeFor } from '@wedding/wireframe';
import { PageView, SiteShell } from '@wedding/skeleton';
import { PlaceholderProvider, ThemedSite, type ThemeOption } from '@wedding/placeholder';
import themes from '../themes/themes.json';

type Params = Promise<{ path?: string[] }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams();
}

const urlOf = (segments: string[] | undefined) => `/${(segments ?? []).join('/')}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: pageForUrl(urlOf((await params).path))?.title };
}

/** Stage 3's page, unchanged, with its slots filled and its tokens pointed at a design. */
export default async function Page({ params }: { params: Params }) {
  const url = urlOf((await params).path);
  const p = pageForUrl(url);
  if (!p) notFound();
  // The real page, captured from the site, redrawn at this stage (stages/02-wireframe/lib/baseline.ts).
  const baseline = BaselinePage({ stage: 'placeholder', pageId: p.id, url });
  if (baseline) return baseline;
  return (
    <>
      <StageBar current="placeholder" path={url} />
      <NoBaselineNote />
      <ThemedSite themes={themes as ThemeOption[]}>
        <PlaceholderProvider>
          <SiteShell current={p.id}>
            <PageView wireframe={wireframeFor(p.id)} />
          </SiteShell>
        </PlaceholderProvider>
      </ThemedSite>
    </>
  );
}
