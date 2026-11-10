import type { Metadata } from 'next';
import { CreditsDocument } from '../_components/CreditsDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photo credits' };

/** For a reader with a session; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default function CreditsPage() {
  return <CreditsDocument reader="request" />;
}
