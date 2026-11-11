import type { Metadata } from 'next';
import { AdventuresView, staticParamsWhenReadable } from '@/app/(public)/_views';

export const revalidate = 300;
export const dynamic = 'error';
export const metadata: Metadata = { title: 'Our Adventures' };

/** Built ahead when the database can be read at build time; otherwise on the first visit. */
export const generateStaticParams = staticParamsWhenReadable;

/** The whole list. A filtered one (`?tag=`, `?season=`) is the per-request page's. */
export default function StaticOurAdventuresPage() {
  return <AdventuresView reader="anonymous" />;
}
