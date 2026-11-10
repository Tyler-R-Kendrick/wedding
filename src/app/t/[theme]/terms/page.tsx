import type { Metadata } from 'next';
import { staticParams } from '@/app/(public)/_views';
import { TermsDocument } from '@/app/(public)/_components/TermsDocument';

export const revalidate = 300;
export const dynamic = 'error';
export const dynamicParams = false;
export const generateStaticParams = staticParams;
export const metadata: Metadata = { title: 'Terms of use' };

export default function StaticTermsPage() {
  return <TermsDocument reader="anonymous" />;
}
