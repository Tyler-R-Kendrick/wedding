import { redirect } from 'next/navigation';
import { isSafeReturnPath } from '@/domain/identity/routes';

/** ADR-0001 names the discovery path `/i/<token>`; the page lives at /invite/[token]. A safe `next` rides along. */
export default async function ShortInvite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const { next } = await searchParams;
  const target = `/invite/${encodeURIComponent(token)}`;
  redirect(isSafeReturnPath(next) ? `${target}?next=${encodeURIComponent(next)}` : target);
}
