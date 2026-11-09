import type { ProvenanceViewData } from '@/domain/content/views';
import './provenance.css';

const TRUST_LABEL: Record<ProvenanceViewData['trustClass'], string> = {
  TRUSTED_WEDDING: 'From Sara + Tyler',
  EXTERNAL_DATA: 'External source',
  UNTRUSTED_USER_CONTENT: 'Guest contribution',
};

/**
 * "Based on …": the source title, linked only when there is somewhere to go. External data is
 * always labelled (ADR-0011 rule 1).
 *
 * An internal source used to render as a `<Link>` to `provenance.url`, and that URL is
 * `publicUrlFor(row, route)` — the route the record itself renders on. So on `/our-story` the
 * page carried seven links reading "Tyler's brief 2026-09-04", one per chapter, each pointing at
 * `/our-story#<the section it sat in>`: pressing one moved a guest to where they already were.
 * Seven promises of a source, each delivering nothing.
 *
 * The route is still right for the capability envelope, where a citation exists so an assistant
 * can name the page a fact lives on (`toRecordCitation`, same helper). It is wrong as a control.
 * A source a guest cannot open — an authored brief, a vendor contract, a venue PDF — is named,
 * not linked; only a real `https://` destination gets an anchor.
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
      ) : (
        <span>{provenance.sourceTitle}</span>
      )}
      {showVersion ? <span> · v{provenance.contentVersion}</span> : null}
    </span>
  );
}

/**
 * A source a guest gains nothing from being told about. The venue's wedding kit is a planning PDF
 * the couple were sent: "External source · CAA Wedding Kit 2027" under a paragraph about a ballroom
 * told a guest nothing they could open or check, and read as an editor's note left on the page. The
 * record keeps its source for the admin console and for the capability envelope; the page does not
 * print it. Anything a guest can follow (the hotel's own site, a transit page) is still named.
 */
export function isNamedForGuests(provenance: Pick<ProvenanceViewData, 'sourceType'>): boolean {
  return provenance.sourceType !== 'venue-document';
}

/** Source + freshness on one line; the standard footer for any record a guest may act on. */
export function ProvenanceLine({ provenance, showVersion = false, children }: { provenance: ProvenanceViewData; showVersion?: boolean; children?: React.ReactNode }) {
  // An unnamed source still has a freshness worth saying ("No longer current"): only the name goes.
  if (!isNamedForGuests(provenance)) return children ? <p className="prov">{children}</p> : null;
  return (
    <p className="prov">
      <SourceBadge provenance={provenance} showVersion={showVersion} />
      {children}
    </p>
  );
}
