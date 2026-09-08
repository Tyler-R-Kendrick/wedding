import type { Metadata } from 'next';
import type { MediaAiStatusView } from '@/capabilities/mediaai';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { ConsoleGate, ConsolePage, Note, ScrollRegion, Section, SubNav } from '../_components/console';
import { INTELLIGENCE_SUBNAV } from '../_components/sections';
import { SuggestionReview } from '@/components/mediaai/SuggestionReview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search index', robots: { index: false, follow: false } };

export default async function AdminAiPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The media search index" />;
  const status = await invokeForRequest<MediaAiStatusView>('admin_media_ai_status', { suggestions: 20 }, principal);
  if (!status.ok) {
    return (
      <ConsolePage title="Search index" actions={<SubNav label="Media and AI" items={INTELLIGENCE_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/ai' }))} />}>
        <Section id="error">
          <Note>{status.error.message}</Note>
        </Section>
      </ConsolePage>
    );
  }
  const { flags, providers, status: counts, suggestions } = status.data;
  return (
    <ConsolePage

      title="Search index"
      lede="What the archive can be searched by, where each description came from, and what is waiting for a person to approve."
      actions={<SubNav label="Media and AI" items={INTELLIGENCE_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/ai' }))} />}
    >
      <Section id="coverage" title="Coverage">
        <ScrollRegion>
          <table className="ops-table con-table">
            <caption className="con-caption">Counts at {counts.lastIndexedAt ? new Date(counts.lastIndexedAt).toLocaleString() : 'no index run yet'}.</caption>
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
        </ScrollRegion>
      </Section>

      <Section id="providers" title="What is switched on">
        <ul className="con-checklist">
          <li>
            <span className="con-checklist__mark" aria-hidden="true">{flags.semanticSearch ? '✓' : '·'}</span>
            <span>
              Semantic search {flags.semanticSearch ? 'on' : 'off'}
              <small>
                Descriptions: {providers.mediaAi.name} ({providers.mediaAi.mode}). Embeddings: {providers.embeddings.model} ({providers.embeddings.dims} dimensions). Index: {providers.vectorIndex.name}
                {providers.vectorIndex.persistent ? ', persistent' : ', in memory'}.
              </small>
            </span>
          </li>
          <li>
            <span className="con-checklist__mark" aria-hidden="true">{flags.proMediaAi.enabled ? '✓' : '·'}</span>
            <span>
              Third-party processing of photographers&apos; media {flags.proMediaAi.enabled ? 'on' : 'off'}
              <small>Flag {flags.proMediaAi.flag ? 'on' : 'off'}, readiness {flags.proMediaAi.readiness ? 'on' : 'off'}. Each vendor also needs written confirmation on their own files.</small>
            </span>
          </li>
        </ul>
      </Section>

      <Section id="review" title={`Waiting for review (${counts.pendingSuggestions})`}>
        <Note>Suggested alt text is a draft. Edit it into your own words before publishing; nothing here reaches a guest until you do.</Note>
        <SuggestionReview initial={suggestions} />
      </Section>
    </ConsolePage>
  );
}
