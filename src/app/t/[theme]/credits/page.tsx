import type { Metadata } from 'next';
import { staticParams } from '@/app/(public)/_views';
import { CreditsDocument } from '@/app/(public)/_components/CreditsDocument';

export const revalidate = 300;
export const dynamic = 'error';
export const dynamicParams = false;
export const generateStaticParams = staticParams;
export const metadata: Metadata = { title: 'Photo credits' };

export default function StaticCreditsPage() {
  return <CreditsDocument reader="anonymous" />;
}
