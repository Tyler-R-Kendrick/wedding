import type { Metadata } from 'next';
import { FilterBar } from '@/components/admin/flow/records';
import { ModerationQueue, type QueueFilters, type QueueResponse } from '@/components/media/ModerationQueue';
import { STATUS_LABEL } from '@/components/media/moderation';
import { ConsoleGate, ConsolePage, Note, Section, SubNav } from '../_components/console';
import { Input } from '../_components/ops';
import { MEDIA_SUBNAV } from '../_components/sections';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { ASSET_STATUSES, MEDIA_KINDS, type AssetStatus } from '@/db/schema/media';
import { isMediaAdmin } from '@/domain/media';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media queue', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * The moderation queue. The state, album and kind filters are a GET form (`FilterBar`), so a
 * filtered queue is a URL that reloads and shares; the queue itself is a client island that selects
 * items and acts on them in bulk (`ModerationQueue`).
 */
export default async function AdminMediaPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <ConsoleGate what="The media queue" />;
  const sp = await searchParams;
  const rawStatus = one(sp.status);
  const rawKind = one(sp.kind);
  const filters: QueueFilters = {
    status: ASSET_STATUSES.includes(rawStatus as AssetStatus) ? (rawStatus as AssetStatus) : 'private',
    collection: one(sp.collection),
    kind: (MEDIA_KINDS as readonly string[]).includes(rawKind ?? '') ? rawKind : undefined,
  };
  const queue = await invokeForRequest<QueueResponse>(
    'admin_list_media',
    { status: filters.status, ...(filters.collection ? { collection: filters.collection } : {}), ...(filters.kind ? { kind: filters.kind } : {}), limit: 50 },
    principal,
  );
  const albums = queue.ok ? queue.data.collections : [];
  // A stable key per filter set: a new filter is a new queue, with nothing carried over from the last one.
  const key = `${filters.status}|${filters.collection ?? ''}|${filters.kind ?? ''}`;

  return (
    <ConsolePage title="Media queue" lede="Everything guests and vendors have added, in the state it is in. Approve to publish; nothing reaches the gallery without a decision here." subNav={<SubNav label="Media" items={MEDIA_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/media' }))} />}>
      <Section id="queue">
        <FilterBar submitLabel="Show" extra={filters.status !== 'private' || filters.collection || filters.kind ? <a className="flow-link" href="/admin/media">Back to what is awaiting review</a> : null}>
          <Input id="status" label="State" defaultValue={filters.status} options={ASSET_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <Input id="collection" label="Album" defaultValue={filters.collection ?? ''} options={[{ value: '', label: 'All albums' }, ...albums.map((c) => ({ value: c.slug, label: c.title }))]} />
          <Input id="kind" label="Kind" defaultValue={filters.kind ?? ''} options={[{ value: '', label: 'Photos and videos' }, { value: 'image', label: 'Photos' }, { value: 'video', label: 'Videos' }]} />
        </FilterBar>
        {queue.ok ? <ModerationQueue key={key} initial={queue.data} filters={filters} /> : <Note>{queue.error.message}</Note>}
      </Section>
    </ConsolePage>
  );
}
