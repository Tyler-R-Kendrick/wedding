import { redirect } from 'next/navigation';

/** ADR-0001 names the discovery path `/i/<token>`; the page lives at /invite/[token]. */
export default async function ShortInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/invite/${encodeURIComponent(token)}`);
}
