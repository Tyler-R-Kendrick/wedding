import Link from 'next/link';
import type { ProvenanceViewData } from '@/domain/content/views';
import './provenance.css';

const TRUST_LABEL: Record<ProvenanceViewData['trustClass'], string> = {
  TRUSTED_WEDDING: 'From Sara + Tyler',
  EXTERNAL_DATA: 'External source',
  UNTRUSTED_USER_CONTENT: 'Guest contribution',
};

/**
 * "Based on …": the source title, linked to the official page for external data or to the
 * page the fact lives on. External data is always labelled (ADR-0011 rule 1).
 */
export function SourceBadge({ provenance, showVersion = false }: { provenance: ProvenanceViewData; showVersion?: boolean }) {
  const label = TRUST_LABEL[provenance.trustClass];
  const external = provenance.url?.startsWith('https://');
  return (
    <span className="prov__source">
      <span className={`prov__badge ${provenance.external ? 'prov__badge--warn' : 'prov__badge--muted'}`}>{label}</span>{' '}
      {provenance.url && external ? (
        <a href={provenance.url} rel="noopener noreferrer" target="_blank">
          {provenance.sourceTitle}
        </a>
      ) : provenance.url ? (
        <Link href={provenance.url}>{provenance.sourceTitle}</Link>
      ) : (
        <span>{provenance.sourceTitle}</span>
      )}
      {showVersion ? <span> · v{provenance.contentVersion}</span> : null}
    </span>
  );
}

/** Source + freshness on one line; the standard footer for any record a guest may act on. */
export function ProvenanceLine({ provenance, showVersion = false, children }: { provenance: ProvenanceViewData; showVersion?: boolean; children?: React.ReactNode }) {
  return (
    <p className="prov">
      <SourceBadge provenance={provenance} showVersion={showVersion} />
      {children}
    </p>
  );
}
