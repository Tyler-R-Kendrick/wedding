import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageForUrl, staticParams } from '@wedding/sitemap';
import { StageBar } from '@wedding/sitemap/chrome';
import { BaselinePage, NoBaselineNote } from '@wedding/wireframe/baseline-page';
import { wireframeFor } from '@wedding/wireframe';
import { Blocks, SiteFrame, StatusRibbon } from '../_components/Greybox';

type Params = Promise<{ path?: string[] }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return staticParams();
}

const urlOf = (segments: string[] | undefined) => `/${(segments ?? []).join('/')}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: pageForUrl(urlOf((await params).path))?.title };
}

export default async function Page({ params }: { params: Params }) {
  const url = urlOf((await params).path);
  const p = pageForUrl(url);
  if (!p) notFound();
  // The real page, captured from the site, redrawn at this stage (stages/02-wireframe/lib/baseline.ts).
  const baseline = BaselinePage({ stage: 'wireframe', pageId: p.id, url });
  if (baseline) return baseline;
  const w = wireframeFor(p.id);
  return (
    <>
      <StageBar current="wireframe" path={url} />
      <NoBaselineNote />
      <StatusRibbon w={w} />
      <SiteFrame current={p}>
        <main id="main" className="gb-main">
          <Blocks blocks={w.blocks} />
        </main>
      </SiteFrame>
    </>
  );
}
