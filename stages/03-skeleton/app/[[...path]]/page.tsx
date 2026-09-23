import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageForUrl, staticParams } from '@wedding/sitemap';
import { StageBar } from '@wedding/sitemap/chrome';
import { wireframeFor } from '@wedding/wireframe';
import { PageView, SiteShell } from '@wedding/skeleton';

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
  return (
    <>
      <StageBar current="skeleton" path={url} />
      <SiteShell current={p.id}>
        <PageView wireframe={wireframeFor(p.id)} />
      </SiteShell>
    </>
  );
}
