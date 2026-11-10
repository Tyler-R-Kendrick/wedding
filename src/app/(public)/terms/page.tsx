import type { Metadata } from 'next';
import { TermsDocument } from '../_components/TermsDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Terms of use' };

/** For a reader with a session; anyone else is served the prerendered copy (src/themes/routes.ts). */
export default function TermsPage() {
  return <TermsDocument reader="request" />;
}
