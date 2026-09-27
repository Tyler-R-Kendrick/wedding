import type { Metadata } from 'next';
import type { MediaAiStatusView } from '@/capabilities/mediaai';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { ConsoleGate, ConsolePage, KeyValues, Note, Pill, Section, Stat, StatStrip, SubNav, formatStamp } from '../_components/console';
import { INTELLIGENCE_SUBNAV } from '../_components/sections';
import { SuggestionReview } from '@/components/mediaai/SuggestionReview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search index', robots: { index: false, follow: false } };

const nav = <SubNav label="Media and AI" items={INTELLIGENCE_SUBNAV.map((i) => ({ ...i, current: i.href === '/admin/ai' }))} />;

/**
 * The media search index: how much of the archive can be searched, what is switched on, and the
 * machine-written alt text waiting for a person. The review queue is the only thing here that
 * changes anything (`SuggestionReview`); the provider internals are folded away at the bottom.
 */
export default async function AdminAiPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The media search index" />;
  const status = await invokeForRequest<MediaAiStatusView>('admin_media_ai_status', { suggestions: 20 }, principal);
  if (!status.ok) {
    return (
      <ConsolePage title="Search index" subNav={nav}>
        <Section id="error">
          <Note>{status.error.message}</Note>
        </Section>
      </ConsolePage>
    );
  }
  const { flags, providers, status: counts, suggestions } = status.data;
  return (
    <ConsolePage title="Search index" lede="What the archive can be searched by, where each description came from, and what is waiting for a person to approve." subNav={nav}>
      <Section id="coverage" title="Coverage" note={counts.lastIndexedAt ? `Counts as of the last index run, ${formatStamp(counts.lastIndexedAt)}.` : 'No index run yet.'}>
        <StatStrip>
          <Stat label="Indexable items" value={counts.indexable} />
          <Stat label="Indexed" value={counts.annotations.byStatus['indexed'] ?? 0} />
          <Stat label="Machine suggestions" value={counts.annotations.withAiCaption} />
          <Stat label="Waiting for review" value={counts.pendingSuggestions} />
        </StatStrip>
        <KeyValues
          items={[
            { label: 'Indexed from metadata only', value: counts.annotations.metadataOnly },
            { label: 'Skipped: professional media without written confirmation', value: counts.annotations.bySkipReason['pro_media_ai_off'] ?? 0 },
            { label: 'Bursts / near-duplicates / exact duplicates', value: `${counts.clusters['burst'] ?? 0} / ${counts.clusters['near_duplicate'] ?? 0} / ${counts.clusters['exact'] ?? 0}` },
            { label: 'Index jobs queued / running / dead', value: `${counts.jobs.queued} / ${counts.jobs.running} / ${counts.jobs.dead}` },
          ]}
        />
      </Section>

      <Section id="switches" title="What is switched on">
        <KeyValues
          items={[
            { label: 'Semantic search', value: flags.semanticSearch ? <Pill tone="good">On</Pill> : <Pill>Off</Pill> },
            {
              label: 'Third-party processing of photographers’ media',
              value: flags.proMediaAi.enabled ? <Pill tone="good">On</Pill> : <Pill>Off</Pill>,
            },
          ]}
        />
        <Note>Photographers’ media needs the flag and its readiness switch on, and each vendor’s written confirmation on their own files.</Note>
      </Section>

      <Section id="review" title={`Waiting for review (${counts.pendingSuggestions})`} note="Suggested alt text is a draft. Publish it as written only when it is already right; otherwise edit it into your own words. Nothing here reaches a guest until you do.">
        <SuggestionReview initial={suggestions} />
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <KeyValues
            items={[
              { label: 'Descriptions', value: `${providers.mediaAi.name} (${providers.mediaAi.mode})` },
              { label: 'Embeddings', value: `${providers.embeddings.model}, ${providers.embeddings.dims} dimensions (${providers.embeddings.mode})` },
              { label: 'Index', value: `${providers.vectorIndex.name}, ${providers.vectorIndex.persistent ? 'persistent' : 'in memory'}` },
              { label: 'Photographers’ media flag', value: flags.proMediaAi.flag ? 'on' : 'off' },
              { label: 'Readiness switch', value: flags.proMediaAi.readiness ? 'on' : 'off' },
            ]}
          />
        </div>
      </details>
    </ConsolePage>
  );
}
