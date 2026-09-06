import type { Metadata } from 'next';
import type { MediaAiStatusView } from '@/capabilities/mediaai';
import { AdminGate } from '@/components/media/AdminMediaNav';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { AdminAiNav } from '@/components/mediaai/AdminAiNav';
import { ScrollableTable } from '@/components/mediaai/ScrollableTable';
import { SuggestionReview } from '@/components/mediaai/SuggestionReview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search index', robots: { index: false, follow: false } };

export default async function AdminAiPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <AdminGate />;
  const status = await invokeForRequest<MediaAiStatusView>('admin_media_ai_status', { suggestions: 20 }, principal);
  if (!status.ok) {
    return (
      <MediaPage eyebrow="Admin" title="Search index" actions={<AdminAiNav current="ai" />}>
        <MediaSection id="error">
          <p className="media-lede">{status.error.message}</p>
        </MediaSection>
      </MediaPage>
    );
  }
  const { flags, providers, status: counts, suggestions } = status.data;
  return (
    <MediaPage
      eyebrow="Admin"
      title="Search index"
      lede="What the archive can be searched by, where each description came from, and what is waiting for a person to approve."
      actions={<AdminAiNav current="ai" />}
    >
      <MediaSection id="coverage" title="Coverage">
        <ScrollableTable label="Index coverage">
          <table className="mi-table">
            <caption className="media-lede">Counts at {counts.lastIndexedAt ? new Date(counts.lastIndexedAt).toLocaleString() : 'no index run yet'}.</caption>
            <tbody>
              <tr>
                <th scope="row">Indexable items</th>
                <td>{counts.indexable}</td>
              </tr>
              <tr>
                <th scope="row">Indexed</th>
                <td>{counts.annotations.byStatus['indexed'] ?? 0}</td>
              </tr>
              <tr>
                <th scope="row">With a machine suggestion</th>
                <td>{counts.annotations.withAiCaption}</td>
              </tr>
              <tr>
                <th scope="row">Indexed from metadata only</th>
                <td>{counts.annotations.metadataOnly}</td>
              </tr>
              <tr>
                <th scope="row">Skipped: professional media without written confirmation</th>
                <td>{counts.annotations.bySkipReason['pro_media_ai_off'] ?? 0}</td>
              </tr>
              <tr>
                <th scope="row">Bursts / near-duplicates / exact duplicates</th>
                <td>
                  {counts.clusters['burst'] ?? 0} / {counts.clusters['near_duplicate'] ?? 0} / {counts.clusters['exact'] ?? 0}
                </td>
              </tr>
              <tr>
                <th scope="row">Index jobs queued / running / dead</th>
                <td>
                  {counts.jobs.queued} / {counts.jobs.running} / {counts.jobs.dead}
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollableTable>
      </MediaSection>

      <MediaSection id="providers" title="What is switched on">
        <ul className="mi-checklist">
          <li>
            <span className="mi-checklist__mark" aria-hidden="true">{flags.semanticSearch ? '✓' : '·'}</span>
            <span>
              Semantic search {flags.semanticSearch ? 'on' : 'off'}
              <small>
                Descriptions: {providers.mediaAi.name} ({providers.mediaAi.mode}). Embeddings: {providers.embeddings.model} ({providers.embeddings.dims} dimensions). Index: {providers.vectorIndex.name}
                {providers.vectorIndex.persistent ? ', persistent' : ', in memory'}.
              </small>
            </span>
          </li>
          <li>
            <span className="mi-checklist__mark" aria-hidden="true">{flags.proMediaAi.enabled ? '✓' : '·'}</span>
            <span>
              Third-party processing of photographers&apos; media {flags.proMediaAi.enabled ? 'on' : 'off'}
              <small>Flag {flags.proMediaAi.flag ? 'on' : 'off'}, readiness {flags.proMediaAi.readiness ? 'on' : 'off'}. Each vendor also needs written confirmation on their own files.</small>
            </span>
          </li>
        </ul>
      </MediaSection>

      <MediaSection id="review" title={`Waiting for review (${counts.pendingSuggestions})`}>
        <p className="media-lede">Suggested alt text is a draft. Edit it into your own words before publishing; nothing here reaches a guest until you do.</p>
        <SuggestionReview initial={suggestions} />
      </MediaSection>
    </MediaPage>
  );
}
