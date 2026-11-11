import type { Metadata } from 'next';
import { adventureMetadata, AdventureView } from '../../_views';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return adventureMetadata('request', (await params).slug);
}

/** For a reader with a session; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default async function AdventurePage({ params }: { params: Params }) {
  return <AdventureView reader="request" slug={(await params).slug} />;
}
