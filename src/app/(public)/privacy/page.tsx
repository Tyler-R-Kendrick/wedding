import type { Metadata } from 'next';
import { PrivacyDocument } from '../_components/PrivacyDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Privacy' };

/** For a reader with a session; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default function PrivacyPage() {
  return <PrivacyDocument reader="request" />;
}
