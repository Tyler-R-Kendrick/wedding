import type { Metadata } from 'next';
import { adventureMetadata, adventureStaticParams, AdventureView } from '@/app/(public)/_views';

type Params = Promise<{ slug: string }>;

export const revalidate = 300;
export const dynamic = 'error';

export const generateStaticParams = adventureStaticParams;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return adventureMetadata('anonymous', (await params).slug);
}

export default async function StaticAdventurePage({ params }: { params: Params }) {
  return <AdventureView reader="anonymous" slug={(await params).slug} />;
}
