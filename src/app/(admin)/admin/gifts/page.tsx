import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { adminListGiftLinks } from '@/capabilities/admin_gifts';
import { listGiftLinksCapability } from '@/capabilities/list_gift_links';
import { GiftFunds } from '@/components/handoff/GiftFunds';
import { GiftLinkCard } from '@/components/handoff/GiftLinkCard';
import { invokeForPage } from '@/components/handoff/server';
import { giftsSetup, RAIL_ORDER, RAILS, registryProviderFor, type NextStep, type SetupStep } from '@/domain/gifts';
import { getLifecycleView } from '@/domain/lifecycle';
import { memberNavFor } from '@/domain/lifecycle/nav';
import { ROUTES } from '@/domain/routes';
import { ConsoleGate, ConsolePage, DataTable, Day, Note, Pill, Section } from '../_components/console';
import { FundFlow } from './_components/FundFlow';
import { QuickAction } from './_components/QuickAction';
import { RailFlow, type RailOption } from './_components/RailFlow';
import { RegistryFlow } from './_components/RegistryFlow';
import './_components/gifts.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Gifts (admin)', robots: { index: false, follow: false } };

/**
 * /admin/gifts: set up what guests can give, and see exactly what they will see.
 *
 * This screen used to be four tables and three long forms. It printed every built-in fund as
 * "Shown: yes" while guests saw none of them (with no way to give there are no funds, by design),
 * asked for slugs and sort numbers, had no way to see the guest page, and lost what was typed on
 * the trip to confirm identity. It is now, top to bottom:
 *
 *   1. Where things stand for guests, in one sentence, with each part's real state.
 *   2. Three steps — wishlist, ways to give, funds — each a short list with the one action that
 *      matters, and each change made in a guided flow (`components/admin/flow`) that checks as it
 *      goes, shows the guest's view before saving, and keeps its draft across reloads and step-up.
 *   3. The guest page itself, rendered from the same capability and components /gifts uses.
 *   4. The raw rows, closed, for when something needs explaining.
 */
export default async function AdminGiftsPage() {
  const { principal, result } = await invokeForPage(adminListGiftLinks, {});
  if (principal.kind !== 'admin') return <ConsoleGate what="Gifts" />;
  if (!result.ok) {
    return (
      <ConsolePage title="Gifts">
        <Note>{result.error.message}</Note>
      </ConsolePage>
    );
  }
  const [{ result: guestView }, lifecycle] = await Promise.all([invokeForPage(listGiftLinksCapability, {}), getLifecycleView()]);
  const data = result.value.data;
  const guest = guestView.ok ? guestView.value.data : null;

  const adminLinks = data.rows;
  const liveWishlist = adminLinks.filter((r) => r.active && !r.placeholder);
  const activeRails = data.rails.filter((r) => r.active);
  const shownFunds = data.funds.filter((f) => f.active);
  const setup = giftsSetup({
    state: lifecycle.state,
    listsGifts: (s) => memberNavFor(s).some((i) => i.href === ROUTES.gifts),
    wishlistLinks: liveWishlist.length,
    rails: activeRails.length,
    shownFunds: shownFunds.length,
  });

  const railOptions: RailOption[] = RAIL_ORDER.map((rail) => {
    const spec = RAILS[rail];
    const current = data.rails.find((r) => r.rail === rail);
    return {
      rail,
      displayName: spec.displayName,
      mode: spec.mode,
      personal: spec.personal,
      ask: spec.ask,
      fee: spec.fee,
      current: current ? { handle: current.handle, recipientName: current.recipientName, active: current.active } : null,
    };
  });
  const linkRailNames = activeRails.filter((r) => RAILS[r.rail].mode === 'link').map((r) => r.displayName);
  const fundIds = data.funds.map((f) => f.id);
  const linkIds = adminLinks.map((r) => r.id);

  return (
    <ConsolePage title="Gifts" lede="Your registry and gifts of money: what guests can give, how they send it, and what the page looks like to them.">
      <section className="gs-status" data-live={setup.live ? '' : undefined} aria-labelledby="gs-status-title">
        <p className="gs-status__eyebrow">{setup.live ? 'Live for guests' : 'Not live for guests yet'}</p>
        <h2 id="gs-status-title" className="gs-status__title">
          {setup.headline}
        </h2>
        <p className="gs-status__line">{setup.steps.page.summary}</p>
        <p className="gs-status__actions">
          {setup.next ? (
            <a className="ops-button ops-button-ghost" href={`#${STEP_ANCHOR[setup.next]}`}>
              Next: {STEP_TITLE[setup.next]}
            </a>
          ) : null}
          <a className="gs-link" href="#gifts-preview">
            See what guests see
          </a>
          <a className="gs-link" href={ROUTES.gifts} target="_blank" rel="noopener">
            Open the Gifts page<span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (new tab)</span>
          </a>
        </p>
      </section>

      <ol className="gs-steps" role="list">
        <SetupCard n={1} id="gift-wishlist" step="wishlist" next={setup.next} done={setup.steps.wishlist.done} title={STEP_TITLE.wishlist}>
          <p className="gs-copy">
            The list itself lives on your registry site: Zola, The Knot or Joy. Guests buy there, and the registry keeps track of what has been bought. This site does not
            copy the list; it sends guests to it, so paste the link your registry gives you.
          </p>
          {adminLinks.length ? (
            <ul className="gs-rows" role="list">
              {adminLinks.map((r) => {
                const host = safeHost(r.url);
                return (
                  <li key={r.id} className="gs-row" data-gift-link-id={r.id}>
                    <div className="gs-row__main">
                      <p className="gs-row__title">
                        {r.label} {r.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>}
                      </p>
                      <p className="gs-row__meta">
                        {registryProviderFor(host)?.name ?? host} · {r.kind === 'registry' ? 'Our wishlist' : 'Our next adventures'} ·{' '}
                        {r.verifiedAt ? (
                          <>
                            you checked it <Day at={r.verifiedAt} />
                          </>
                        ) : (
                          'not checked yet'
                        )}
                      </p>
                    </div>
                    <div className="gs-row__actions">
                      <a className="gs-link" href={r.url} target="_blank" rel="noopener noreferrer">
                        Open<span aria-hidden="true"> ↗</span>
                        <span className="sr-only"> {r.label} (new tab)</span>
                      </a>
                      <RegistryFlow existing={{ ...r }} takenIds={linkIds} variant="quiet" label="Change" />
                      <QuickAction
                        label={r.active ? 'Hide' : 'Show'}
                        busyLabel={r.active ? 'Hiding…' : 'Showing…'}
                        accessibleName={`${r.active ? 'Hide' : 'Show'} ${r.label}`}
                        calls={[
                          {
                            capability: 'admin_upsert_gift_link',
                            input: { id: r.id, kind: r.kind, provider: r.provider, label: r.label, url: r.url, note: r.note ?? undefined, disclosure: r.disclosure ?? undefined, sortOrder: r.sortOrder, placeholder: r.placeholder, active: !r.active, verifiedAt: r.verifiedAt ?? undefined },
                          },
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="gs-empty">No registry linked. Guests read that you have not chosen where to keep a wishlist yet.</p>
          )}
          <RegistryFlow takenIds={linkIds} variant={setup.next === 'wishlist' ? 'primary' : 'ghost'} label={adminLinks.length ? 'Add another link' : 'Link your registry'} />
        </SetupCard>

        {data.fundsAvailable ? (
          <>
            <SetupCard n={2} id="gift-rails" step="rails" next={setup.next} done={setup.steps.rails.done} title={STEP_TITLE.rails}>
              <p className="gs-copy">Your own Venmo, PayPal, Cash App, Zelle or a mailing address for checks. Money goes from a guest’s account straight to yours; this site never holds it or adds a fee.</p>
              {data.rails.length ? (
                <ul className="gs-rows" role="list">
                  {data.rails.map((r) => (
                    <li key={r.rail} className="gs-row" data-admin-gift-rail={r.rail}>
                      <div className="gs-row__main">
                        <p className="gs-row__title">
                          {r.displayName} {r.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>}
                        </p>
                        <p className="gs-row__meta gs-row__meta--pre">
                          {r.handle}
                          {r.recipientName ? ` · ${r.recipientName}` : ''}
                        </p>
                      </div>
                      <div className="gs-row__actions">
                        <RailFlow options={railOptions} editing={r.rail} variant="quiet" label="Change" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="gs-empty">None yet. Until you add one, guests see no gifts of money at all.</p>
              )}
              {data.rails.length < RAIL_ORDER.length ? <RailFlow options={railOptions} variant={setup.next === 'rails' ? 'primary' : 'ghost'} label={data.rails.length ? 'Add another way' : 'Add a way to give'} /> : null}
            </SetupCard>

            <SetupCard n={3} id="gift-funds" step="funds" next={setup.next} done={setup.steps.funds.done} title={STEP_TITLE.funds}>
              <p className="gs-copy">Guests pick one of these, then how to send it. Venmo’s note carries the fund’s name, so you can tell a honeymoon gift from a house gift.</p>
              {!activeRails.length ? (
                <p className="gs-blocked" role="note">
                  <strong>Hidden from guests until you add a way to give.</strong> A list of things to give toward, with no way to give, would be a dead end, so the Gifts page leaves these out until you add a way to give.
                </p>
              ) : null}
              <ul className="gs-rows" role="list">
                {data.funds.map((f, i) => {
                  const prev = data.funds[i - 1];
                  const next = data.funds[i + 1];
                  const move = (other: NonNullable<typeof prev>) => [
                    { capability: 'admin_upsert_gift_fund', input: { id: f.id, title: f.title, sortOrder: other.sortOrder === f.sortOrder ? other.sortOrder + (other === prev ? -1 : 1) : other.sortOrder } },
                    { capability: 'admin_upsert_gift_fund', input: { id: other.id, title: other.title, sortOrder: f.sortOrder } },
                  ];
                  return (
                    <li key={f.id} className="gs-row" data-gift-fund-id={f.id}>
                      <div className="gs-row__main">
                        <p className="gs-row__title">
                          {f.title} {f.active ? activeRails.length ? <Pill tone="good">Shown</Pill> : <Pill>Ready, waiting on a way to give</Pill> : <Pill>Hidden</Pill>}
                        </p>
                        {f.description ? <p className="gs-row__meta">{f.description}</p> : null}
                      </div>
                      <div className="gs-row__actions">
                        <FundFlow fund={f} takenIds={fundIds} rails={linkRailNames} variant="quiet" label="Change" />
                        <QuickAction label={f.active ? 'Hide' : 'Show'} busyLabel="Saving…" done={f.active ? `${f.title} hidden.` : `${f.title} shown.`} accessibleName={`${f.active ? 'Hide' : 'Show'} ${f.title}`} calls={[{ capability: 'admin_upsert_gift_fund', input: { id: f.id, title: f.title, active: !f.active } }]} />
                        <QuickAction label="Up" busyLabel="Moving…" done={`Moved ${f.title} up.`} unavailable={!prev} accessibleName={`Move ${f.title} up`} calls={prev ? move(prev) : []} />
                        <QuickAction label="Down" busyLabel="Moving…" done={`Moved ${f.title} down.`} unavailable={!next} accessibleName={`Move ${f.title} down`} calls={next ? move(next) : []} />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <FundFlow takenIds={fundIds} rails={linkRailNames} variant={setup.next === 'funds' && activeRails.length ? 'primary' : 'ghost'} label="Add a fund" />
            </SetupCard>
          </>
        ) : (
          <li className="gs-step">
            <Section title="Gifts of money" id="gift-funds">
              <Note>
                This copy of the site is running on a database that has not had the gifts-of-money update yet. That update runs when the change is deployed to the live site; after that,
                the funds and ways to give appear here.
              </Note>
            </Section>
          </li>
        )}
      </ol>

      <section id="gifts-preview" className="gs-preview" aria-labelledby="gifts-preview-title">
        <div className="gs-preview__head">
          <h2 id="gifts-preview-title" className="gs-section-title">
            What guests see
          </h2>
          <p className="con-note">
            The Gifts page, built from the same data and pieces guests get, in the console’s plain styling. The real page wears your chosen design.{' '}
            {guest?.rails.some((r) => RAILS[r.rail].personal) ? 'You see Zelle and check details here; guests see them only once they have opened the site from their invitation.' : ''}
          </p>
        </div>
        {guest ? (
          <div className="gs-preview__page">
            <p className="gs-preview__eyebrow">{guest.copy.eyebrow}</p>
            <p className="gs-preview__title">{guest.copy.title}</p>
            <p className="measure">{guest.copy.lede}</p>
            <h3 className="gs-preview__h">{guest.copy.registryHeading}</h3>
            {guest.links.filter((l) => l.kind === 'registry').length ? (
              guest.links.filter((l) => l.kind === 'registry').map((l) => <GiftLinkCard key={l.id} link={l} />)
            ) : (
              <p className="gs-preview__gap">Guests read: “Sara + Tyler are still writing this: {guest.copy.registryPending}.”</p>
            )}
            <h3 className="gs-preview__h">{guest.copy.adventureHeading}</h3>
            {guest.funds.length ? <GiftFunds data={guest} /> : null}
            {guest.links
              .filter((l) => l.kind === 'adventure-fund')
              .map((l) => (
                <GiftLinkCard key={l.id} link={l} />
              ))}
            {!guest.funds.length && !guest.links.some((l) => l.kind === 'adventure-fund') ? (
              <p className="gs-preview__gap">Guests read: “Sara + Tyler are still writing this: {guest.copy.adventurePending}.”</p>
            ) : null}
          </div>
        ) : (
          <Note>The guest view could not be built: {guestView.ok ? '' : guestView.error.message}</Note>
        )}
      </section>

      <details className="gs-details">
        <summary>Technical details</summary>
        <div className="gs-details__body">
          <Note>What the Gifts capability returns to guests, and every saved row including hidden ones. For troubleshooting; nothing here needs changing by hand.</Note>
          <DataTable
            caption="Links guests are given"
            empty={data.effective.length ? null : 'None: no active registry links are saved.'}
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Kind</th>
                <th scope="col">Label</th>
                <th scope="col">Host</th>
                <th scope="col">Source</th>
              </tr>
            }
          >
            {data.effective.map((l) => (
              <tr key={l.id}>
                <td>{l.id}</td>
                <td>{l.kind}</td>
                <td>{l.label}</td>
                <td>{l.host}</td>
                <td>{l.origin}</td>
              </tr>
            ))}
          </DataTable>
          <DataTable
            caption="Funds, as saved"
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Title</th>
                <th scope="col">Order</th>
                <th scope="col">Switched on</th>
                <th scope="col">Words from</th>
              </tr>
            }
          >
            {data.funds.map((f) => (
              <tr key={f.id}>
                <td>{f.id}</td>
                <td>{f.title}</td>
                <td>{f.sortOrder}</td>
                <td>{f.active ? 'yes' : 'no'}</td>
                <td>{f.origin === 'default' ? 'built in' : 'you'}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}

const STEP_TITLE: Record<NextStep, string> = { wishlist: 'Registry', rails: 'Ways to give', funds: 'Funds' };
const STEP_ANCHOR: Record<NextStep, string> = { wishlist: 'gift-wishlist', rails: 'gift-rails', funds: 'gift-funds' };

function SetupCard({ n, id, step, next, done, title, children }: { n: number; id: string; step: SetupStep; next: SetupStep | null; done: boolean; title: string; children: ReactNode }) {
  const current = next === step;
  return (
    <li className="gs-step" id={id} data-done={done ? '' : undefined} data-current={current ? '' : undefined} aria-labelledby={`${id}-title`}>
      <span className="gs-step__num" aria-hidden="true">
        {done ? '✓' : n}
      </span>
      <div className="gs-step__body">
        <h2 id={`${id}-title`} className="gs-step__title">
          <span className="sr-only">Step {n}: </span>
          {title}
          {current ? <span className="gs-step__next">Next</span> : null}
        </h2>
        {children}
      </div>
    </li>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
