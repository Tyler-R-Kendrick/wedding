'use client';

import type { ReactNode } from 'react';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { RevokeLinkFlow, RotateLinkFlow } from './InvitationFlows';

/** A link as the page lists it, dates already rendered (the page uses the console's `Day`, in the wedding's time zone). */
export interface InvitationRowView {
  id: string;
  householdName: string;
  tokenPrefix: string;
  lifecycle: 'active' | 'claimed' | 'expired' | 'revoked';
  revokedReason: string | null;
  rotatedFromId: string | null;
  events: string;
  allowances: string;
  expires: ReactNode;
  claimed: ReactNode | null;
}

const PILL: Record<InvitationRowView['lifecycle'], { tone: string; label: string }> = {
  active: { tone: 'good', label: 'Active' },
  claimed: { tone: 'good', label: 'Opened and claimed' },
  expired: { tone: 'warn', label: 'Expired' },
  revoked: { tone: 'neutral', label: 'Revoked' },
};

/**
 * Each link's React key follows its line of replacements: the link in use is keyed by the first link
 * it replaced, and a link that was replaced gets a key of its own.
 *
 * That is what keeps the new link on screen. Replacing a link revokes the old one, and the refresh
 * that follows would render its row without actions, unmounting the sheet — and with it the Done
 * panel, the only place the new link is ever shown. Keyed this way, the new link's row takes over
 * the old row's key, so React keeps the same sheet, still open, on the same Done panel.
 */
function lineageKeys(rows: InvitationRowView[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const replaced = new Set(rows.map((r) => r.rotatedFromId).filter((id): id is string => Boolean(id)));
  const keys = new Map<string, string>();
  const used = new Set<string>();
  for (const r of rows) {
    let key: string;
    if (replaced.has(r.id)) key = `${r.id}:replaced`;
    else {
      let root = r;
      for (let hops = 0; root.rotatedFromId && byId.has(root.rotatedFromId) && hops < 100; hops++) root = byId.get(root.rotatedFromId)!;
      key = root.id;
    }
    if (used.has(key)) key = r.id;
    used.add(key);
    keys.set(r.id, key);
  }
  return keys;
}

/**
 * `rows` is every link, including revoked ones, so the keys are worked out over the whole line of
 * replacements; `showRevoked` only decides which rows are drawn.
 */
export function InvitationList({ rows, showRevoked }: { rows: InvitationRowView[]; showRevoked: boolean }) {
  const keys = lineageKeys(rows);
  const shown = showRevoked ? rows : rows.filter((r) => r.lifecycle !== 'revoked');
  const empty = shown.length ? null : rows.length ? 'Every link has been replaced or revoked. Tick “Show replaced and revoked links” to see them.' : 'No invitation link has been made yet.';
  return (
    <RecordList label="Invitation links" empty={empty}>
      {shown.map((r) => {
        const pill = r.lifecycle === 'revoked' && r.revokedReason === 'rotated' ? { tone: 'neutral', label: 'Replaced' } : PILL[r.lifecycle];
        const summary = { id: r.id, householdName: r.householdName, tokenPrefix: r.tokenPrefix };
        return (
          <RecordRow
            key={keys.get(r.id)}
            data-invitation-id={r.id}
            title={r.householdName}
            status={<span className={`con-pill con-pill--${pill.tone}`}>{pill.label}</span>}
            meta={
              <>
                {r.events} · {r.allowances} · {r.lifecycle === 'expired' ? 'expired' : 'works until'} {r.expires}
                {r.claimed ? (
                  <>
                    {' '}
                    · claimed {r.claimed}
                  </>
                ) : null}
                {r.lifecycle === 'revoked' && r.revokedReason && r.revokedReason !== 'rotated' ? ` · ${r.revokedReason}` : ''}
              </>
            }
            actions={
              r.lifecycle !== 'revoked' ? (
                <>
                  <RotateLinkFlow invitation={summary} />
                  <RevokeLinkFlow invitation={summary} />
                </>
              ) : null
            }
          />
        );
      })}
    </RecordList>
  );
}
