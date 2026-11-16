import type { Metadata } from 'next';
import { Assistant } from '@/components/admin/assistant/Assistant';
import { adminPrincipal } from '../../_shared/admin';
import { ConsoleGate } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assistant', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Ask the console. The page is a frame for the conversation; everything it shows comes back from
 * `admin_assistant_answer`, which reads through the same capabilities as the screens around it.
 */
export default async function AdminAssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The assistant" />;
  const sp = await searchParams;
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return (
    <main id="main" className="ops ops--wide ask-page">
      <h1 className="sr-only">Assistant</h1>
      <Assistant initialQuestion={typeof q === 'string' ? q.slice(0, 500) : undefined} />
    </main>
  );
}
