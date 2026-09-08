import type { Metadata } from 'next';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin, type MediaMetrics } from '@/domain/media';
import { formatBytes } from '@/lib/media/limits';
import { ConsoleGate, ConsolePage, KeyValues, Note, Section, SubNav } from '../../_components/console';
import { MEDIA_SUBNAV } from '../../_components/sections';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media storage and cost', robots: { index: false, follow: false } };

const nav = <SubNav label="Media" items={MEDIA_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/media/metrics' }))} />;

/**
 * Storage, counts and an estimated bill.
 *
 * The three `<dl>`s were `media-metrics` — a two-column grid defined in the media stylesheet — and
 * are the console's own `KeyValues` now. Same markup shape, one definition, and the screen no
 * longer carries a second design system in for three lists.
 */
export default async function MetricsPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <ConsoleGate what="Media storage and cost" />;
  const r = await invokeForRequest<MediaMetrics & { jobs: Record<string, number> }>('admin_media_metrics', {}, principal);
  if (!r.ok) {
    return (
      <ConsolePage title="Storage and cost" actions={nav}>
        <Note>{r.error.message}</Note>
      </ConsolePage>
    );
  }
  const m = r.data;
  return (
    <ConsolePage
      title="Storage and cost (approximate)"
      lede="Counts and bytes are exact as of now; the cost line is an estimate at an assumed price and is not a bill."
      actions={nav}
    >
      <Section title="Items" id="items">
        <KeyValues
          items={[
            { label: 'Total', value: m.assets.total },
            ...Object.entries(m.assets.byStatus).map(([k, v]) => ({ label: k, value: v })),
            { label: 'Photos / videos', value: `${m.assets.byKind['image'] ?? 0} / ${m.assets.byKind['video'] ?? 0}` },
            { label: 'Guest / couple / professional', value: `${m.assets.bySource['guest'] ?? 0} / ${m.assets.bySource['couple'] ?? 0} / ${m.assets.bySource['professional'] ?? 0}` },
            { label: 'Duplicate clusters', value: `${m.duplicates.exactClusters} (${m.duplicates.assetsInClusters} items)` },
          ]}
        />
      </Section>
      <Section title="Uploads" id="uploads">
        <KeyValues
          items={[
            { label: 'Open sessions', value: m.uploads.pending },
            { label: 'Completed', value: m.uploads.completed },
            { label: 'Rejected', value: m.uploads.rejected },
            { label: 'Aborted / expired', value: `${m.uploads.aborted} / ${m.uploads.expired}` },
            { label: 'Jobs', value: Object.entries(m.jobs).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none' },
          ]}
        />
      </Section>
      <Section title="Storage" id="storage">
        <KeyValues
          items={[
            { label: 'Originals', value: formatBytes(m.bytes.originals) },
            { label: 'Derivatives', value: `${formatBytes(m.bytes.derivatives)} in ${m.derivativeFiles} files` },
            { label: 'Total', value: formatBytes(m.bytes.total) },
            { label: 'Average original', value: formatBytes(m.averageOriginalBytes) },
            { label: 'Estimated monthly storage', value: `$${m.estimatedMonthlyUsd.toFixed(2)} at $${m.pricing.usdPerGbMonth}/GB-month` },
          ]}
        />
        <Note>
          {m.pricing.note} Price verified: {m.pricing.verifiedAt ?? 'not yet (TODO(Tyler & Sara): confirm the current object-storage price list)'}.
        </Note>
      </Section>
    </ConsolePage>
  );
}
