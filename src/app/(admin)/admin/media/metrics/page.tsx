import type { Metadata } from 'next';
import { AdminGate, AdminMediaNav } from '@/components/media/AdminMediaNav';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { isMediaAdmin, type MediaMetrics } from '@/domain/media';
import { formatBytes } from '@/lib/media/limits';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Media storage and cost', robots: { index: false, follow: false } };

export default async function MetricsPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin' || !isMediaAdmin(principal)) return <AdminGate />;
  const r = await invokeForRequest<MediaMetrics & { jobs: Record<string, number> }>('admin_media_metrics', {}, principal);
  if (!r.ok) {
    return (
      <MediaPage eyebrow="Admin" title="Storage and cost" actions={<AdminMediaNav current="metrics" />}>
        <p className="media-lede">{r.error.message}</p>
      </MediaPage>
    );
  }
  const m = r.data;
  const row = (label: string, value: string) => (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
  return (
    <MediaPage eyebrow="Admin" title="Storage and cost (approximate)" lede="Counts and bytes are exact as of now; the cost line is an estimate at an assumed price and is not a bill." actions={<AdminMediaNav current="metrics" />}>
      <MediaSection title="Items" id="items">
        <dl className="media-metrics">
          {row('Total', String(m.assets.total))}
          {Object.entries(m.assets.byStatus).map(([k, v]) => (
            <span key={k} style={{ display: 'contents' }}>
              {row(k, String(v))}
            </span>
          ))}
          {row('Photos / videos', `${m.assets.byKind['image'] ?? 0} / ${m.assets.byKind['video'] ?? 0}`)}
          {row('Guest / couple / professional', `${m.assets.bySource['guest'] ?? 0} / ${m.assets.bySource['couple'] ?? 0} / ${m.assets.bySource['professional'] ?? 0}`)}
          {row('Duplicate clusters', `${m.duplicates.exactClusters} (${m.duplicates.assetsInClusters} items)`)}
        </dl>
      </MediaSection>
      <MediaSection title="Uploads" id="uploads">
        <dl className="media-metrics">
          {row('Open sessions', String(m.uploads.pending))}
          {row('Completed', String(m.uploads.completed))}
          {row('Rejected', String(m.uploads.rejected))}
          {row('Aborted / expired', `${m.uploads.aborted} / ${m.uploads.expired}`)}
          {row('Jobs', Object.entries(m.jobs).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none')}
        </dl>
      </MediaSection>
      <MediaSection title="Storage" id="storage">
        <dl className="media-metrics">
          {row('Originals', formatBytes(m.bytes.originals))}
          {row('Derivatives', `${formatBytes(m.bytes.derivatives)} in ${m.derivativeFiles} files`)}
          {row('Total', formatBytes(m.bytes.total))}
          {row('Average original', formatBytes(m.averageOriginalBytes))}
          {row('Estimated monthly storage', `$${m.estimatedMonthlyUsd.toFixed(2)} at $${m.pricing.usdPerGbMonth}/GB-month`)}
        </dl>
        <p className="media-note">
          {m.pricing.note} Price verified: {m.pricing.verifiedAt ?? 'not yet (TODO(Tyler & Sara): confirm the current object-storage price list)'}.
        </p>
      </MediaSection>
    </MediaPage>
  );
}
