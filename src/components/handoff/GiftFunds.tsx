import type { GiftLinks } from '@/capabilities/list_gift_links';
import { list } from '@/domain/gifts/copy';
import { RAILS } from '@/domain/gifts/rails';

/**
 * Gifts of money (ADR-0013): what they can go toward, and how to send one.
 *
 * Every fund card carries the same handful of links — the couple's own Venmo, PayPal.Me and
 * $Cashtag — because the fund is what a guest chooses and the app is how they happen to pay. Venmo's
 * link carries the fund in its note, so the couple can tell a honeymoon gift from a house gift
 * without the site ever learning that either was sent.
 *
 * Zelle and checks have no link: a guest types the details into their own bank or onto an envelope.
 * Those details are personal, so they appear only for a guest who opened the site from their
 * invitation; everyone else is told how to see them. Each way to give says what its network charges
 * the sender, in that network's words, because "no fee" is only true of some ways to pay.
 *
 * Tokens and the guest kit only (`.btn`, `.measure`, `.hint`); each design restyles them.
 */
export function GiftFunds({ data }: { data: Pick<GiftLinks, 'copy' | 'funds' | 'rails'> }) {
  const { copy, funds, rails } = data;
  if (!funds.length || !rails.length) return null;
  const direct = rails.filter((r) => r.mode === 'direct');
  return (
    <div data-gift-funds="">
      <p className="measure">{copy.fundsIntro}</p>
      <ul className="mt-2" role="list">
        {funds.map((f) => (
          <li key={f.id} data-gift-fund={f.id} className="border-t border-primary/20 py-6">
            <h3 id={`gift-fund-${f.id}`} className="text-xl">
              {f.title}
            </h3>
            {f.description ? <p className="mt-2 measure">{f.description}</p> : null}
            {f.links.length ? (
              <ul className="mt-4 flex flex-wrap gap-3" role="list" aria-labelledby={`gift-fund-${f.id}`}>
                {f.links.map((l) => (
                  <li key={l.rail}>
                    <a
                      className="btn btn--secondary"
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer external"
                      data-handoff-provider={l.provider}
                      data-record-capability="open_gift_fund"
                      data-record-input={JSON.stringify({ fundId: f.id, rail: l.rail })}
                    >
                      {l.label}
                      <span aria-hidden="true">↗</span>
                      <span className="sr-only">
                        {' '}
                        toward {f.title} (opens {l.providerDisplayName} in a new tab)
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {direct.length ? (
              <p className="mt-3 measure hint">
                {f.links.length ? 'Prefer' : 'Send it with'} {list(direct.map((r) => RAILS[r.rail].inSentence), 'or')}
                {f.links.length ? '? See' : ': see'} <a href="#gifts-ways-title">{copy.waysHeading.toLowerCase()}</a>.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 id="gifts-ways-title" className="mt-6 text-xl">
        {copy.waysHeading}
      </h3>
      <p className="mt-2 measure">{copy.waysIntro}</p>
      <dl className="mt-4">
        {rails.map((r) => (
          <div key={r.rail} data-gift-rail={r.rail} className="border-t border-primary/20 py-4">
            <dt className="text-lg">{r.displayName}</dt>
            <dd className="mt-1 measure">
              {r.instructions ? <p className="whitespace-pre-line">{r.instructions}</p> : null}
              {r.needsInvitation ? <p>{copy.needsInvitation}</p> : null}
              {r.recipientName && r.rail !== 'check' ? (
                <p>
                  {copy.confirmName} <strong>{r.recipientName}</strong>.
                </p>
              ) : null}
              <p className="hint">{r.fee}</p>
              {r.rail === 'venmo' ? <p className="hint">{copy.venmoPrivacy}</p> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
