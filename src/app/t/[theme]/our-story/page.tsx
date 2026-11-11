import type { Metadata } from 'next';
import { StoryView, staticParamsWhenReadable } from '@/app/(public)/_views';

export const revalidate = 300;
export const dynamic = 'error';
export const metadata: Metadata = { title: 'Our Story' };

/** Built ahead when the database can be read at build time; otherwise on the first visit. */
export const generateStaticParams = staticParamsWhenReadable;

export default function StaticOurStoryPage() {
  return <StoryView reader="anonymous" />;
}
