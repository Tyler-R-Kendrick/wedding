import { formatDate } from '@/domain/content/format';
import { FRESHNESS_LABELS, needsCaveat } from '@/domain/content/freshness';
import type { ProvenanceViewData } from '@/domain/content/views';
import './provenance.css';

/**
 * fresh / aging / stale / expired / not-yet-valid, always with the verification date.
 * Past the freshness budget it adds "Last checked <date>. Confirm with <official link>."
 * (ADR-0011 rule 3). The date is said once: a badge that already reads "Last checked" is
 * followed by the link alone. Text, never colour alone.
 */
export function FreshnessBadge({ provenance, withCaveat = true }: { provenance: ProvenanceViewData; withCaveat?: boolean }) {
  const { label, tone } = FRESHNESS_LABELS[provenance.freshness];
  const date = formatDate(provenance.verifiedAt);
  const caveat = withCaveat && needsCaveat(provenance.freshness);
  const confirmUrl = provenance.external ? provenance.url : undefined;
  const saysChecked = label === FRESHNESS_LABELS.aging.label;
  return (
    <span className="prov__freshness" data-freshness={provenance.freshness}>
      <span className={`prov__badge prov__badge--${tone}`}>
        {label} <time dateTime={provenance.verifiedAt}>{date}</time>
      </span>
      {provenance.freshness === 'expired' && provenance.validUntil ? (
        <span className="prov__caveat">
          Not current since <time dateTime={provenance.validUntil}>{formatDate(provenance.validUntil)}</time>.
        </span>
      ) : null}
      {caveat && provenance.freshness !== 'expired' && (!saysChecked || confirmUrl) ? (
        <span className="prov__caveat">
          {saysChecked ? null : (
            <>
              Last checked <time dateTime={provenance.verifiedAt}>{date}</time>.
            </>
          )}
          {confirmUrl ? (
            <>
              {saysChecked ? '' : ' '}
              Confirm with{' '}
              <a href={confirmUrl} rel="noopener noreferrer" target="_blank">
                the official page
              </a>
              .
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
