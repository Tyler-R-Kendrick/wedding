import type { Metadata } from 'next';
import { staticParams } from '@/app/(public)/_views';
import { PrivacyDocument } from '@/app/(public)/_components/PrivacyDocument';

export const revalidate = 300;
export const dynamic = 'error';
export const dynamicParams = false;
export const generateStaticParams = staticParams;
export const metadata: Metadata = { title: 'Privacy' };

export default function StaticPrivacyPage() {
  return <PrivacyDocument reader="anonymous" />;
}
