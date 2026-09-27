import type { Metadata } from 'next';
import { currentPrincipal, runAsUi } from '@/app/(public)/travel/_shared/server';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { adminGetTravelConfig } from '@/capabilities/travel';
import type { HotelRecommendation } from '@/domain/travel';
import { ConsoleGate, ConsolePage, DataTable, Day, Denied, KeyValues, Note, Pill, Section } from '../_components/console';
import { HotelFlow, DeleteHotelFlow } from './_components/HotelFlow';
import { LinkFlow, DeleteLinkFlow } from './_components/LinkFlow';
import { categoryLabel, hotelInput, linkInput, swapOrder } from './_components/travel-input';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Travel (admin)', robots: { index: false, follow: false } };

/**
 * Travel and stay: the venue's room block, the hotels the couple recommend, and the partner links.
 *
 * Every hotel used to be printed as its own open form, one after another, with a "Sort order", a
 * "Source id (provenance)", reasons typed as `kind | text | value` and a room-block fieldset on every
 * hotel whether or not it was the venue; a red "Remove" sat under each. Each change is now a flow
 * from the kit (`components/admin/flow/CONVENTIONS.md`): Edit and Delete on the row, Show/Hide and
 * Up/Down as one click, and the provider status and raw rows in the closed details at the bottom.
 */
export default async function AdminTravelPage() {
  const { principal } = await currentPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Travel and stay" />;
  const config = await runAsUi(adminGetTravelConfig, {});
  if (!config.ok) {
    return (
      <ConsolePage title="Travel and stay">
        <Denied message={config.error.message} />
      </ConsolePage>
    );
  }
  const { providers, hotels, links, allowedHosts } = config.value.data;
  const others = hotels.filter((h) => !h.isVenue);
  const nextHotelSort = Math.max(100, ...others.map((h) => h.sortOrder + 10));
  const nextLinkSort = Math.max(100, ...links.map((l) => l.sortOrder + 10));
  const missing = providers ? (['flights', 'hotels'] as const).filter((k) => providers[k].config.missing.length) : [];

  return (
    <ConsolePage
      title="Travel and stay"
      lede="Where guests sleep and how they get here: the venue’s room block, the hotels you recommend nearby, and links to book travel."
      actions={<HotelFlow allowedHosts={allowedHosts} nextSort={nextHotelSort} label="Add a hotel" />}
    >
      {missing.length ? <Note>Live {missing.join(' and ')} search is not fully set up, so guests are offered the links below instead. The technical details at the bottom say what is missing.</Note> : null}

      <Section title="The room block and hotels" id="hotels">
        <RecordList label="Hotels">
          {hotels.map((h) => {
            const i = others.indexOf(h);
            const prev = i > 0 ? others[i - 1] : undefined;
            const next = i >= 0 ? others[i + 1] : undefined;
            const move = (other: HotelRecommendation, before: boolean) => swapOrder(h, other, before, hotelInput, 'admin_save_hotel');
            return (
              <RecordRow
                key={h.id}
                data-hotel-id={h.id}
                title={h.name}
                status={
                  <>
                    {h.isVenue ? <Pill>Venue, holds the room block</Pill> : null}{' '}
                    {h.synthesized ? <Pill tone="warn">From the brief, not saved yet</Pill> : h.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>}{' '}
                    {h.placeholder ? <Pill tone="warn">Details to confirm</Pill> : null}
                  </>
                }
                meta={<HotelMeta hotel={h} />}
                actions={
                  <>
                    <HotelFlow
                      hotel={{ id: h.id, name: h.name, isVenue: h.isVenue, synthesized: h.synthesized }}
                      allowedHosts={allowedHosts}
                      variant="quiet"
                      label={h.synthesized ? 'Set up' : 'Edit'}
                      accessibleName={`${h.synthesized ? 'Set up' : 'Edit'} ${h.name}`}
                    />
                    {!h.synthesized ? (
                      <QuickAction
                        label={h.active ? 'Hide' : 'Show'}
                        busyLabel={h.active ? 'Hiding…' : 'Showing…'}
                        done={h.active ? `${h.name} hidden.` : `${h.name} shown.`}
                        accessibleName={`${h.active ? 'Hide' : 'Show'} ${h.name}`}
                        calls={[{ capability: 'admin_save_hotel', input: hotelInput(h, { active: !h.active }) }]}
                      />
                    ) : null}
                    {i >= 0 && others.length > 1 ? (
                      <>
                        <QuickAction label="Up" busyLabel="Moving…" done={`Moved ${h.name} up.`} unavailable={!prev} accessibleName={`Move ${h.name} up`} calls={prev ? move(prev, true) : []} />
                        <QuickAction label="Down" busyLabel="Moving…" done={`Moved ${h.name} down.`} unavailable={!next} accessibleName={`Move ${h.name} down`} calls={next ? move(next, false) : []} />
                      </>
                    ) : null}
                    {!h.synthesized ? <DeleteHotelFlow hotel={{ id: h.id, name: h.name, isVenue: h.isVenue, synthesized: false }} /> : null}
                  </>
                }
              />
            );
          })}
        </RecordList>
      </Section>

      <Section title="Links to book travel" id="links" note="Shown on Travel & Stay, and offered instead of live search when it is unavailable.">
        <RecordList label="Travel links" empty={links.length ? null : 'No links yet. Guests see only the hotels above until you add one.'}>
          {links.map((l, i) => {
            const prev = links[i - 1];
            const next = links[i + 1];
            return (
              <RecordRow
                key={l.id}
                data-travel-link-id={l.id}
                title={l.label}
                status={l.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>}
                meta={
                  <>
                    {categoryLabel(l.category)} · {l.provider} · {safeHost(l.url)}
                    {l.note ? ` · ${l.note}` : ''}
                  </>
                }
                actions={
                  <>
                    <a className="flow-link" href={l.url} target="_blank" rel="noopener noreferrer">
                      Open<span aria-hidden="true"> ↗</span>
                      <span className="sr-only"> {l.label} (new tab)</span>
                    </a>
                    <LinkFlow link={l} allowedHosts={allowedHosts} variant="quiet" label="Edit" accessibleName={`Edit ${l.label}`} />
                    <QuickAction
                      label={l.active ? 'Hide' : 'Show'}
                      busyLabel={l.active ? 'Hiding…' : 'Showing…'}
                      done={l.active ? `${l.label} hidden.` : `${l.label} shown.`}
                      accessibleName={`${l.active ? 'Hide' : 'Show'} ${l.label}`}
                      calls={[{ capability: 'admin_save_travel_link', input: linkInput(l, { active: !l.active }) }]}
                    />
                    <QuickAction label="Up" busyLabel="Moving…" done={`Moved ${l.label} up.`} unavailable={!prev} accessibleName={`Move ${l.label} up`} calls={prev ? swapOrder(l, prev, true, linkInput, 'admin_save_travel_link') : []} />
                    <QuickAction label="Down" busyLabel="Moving…" done={`Moved ${l.label} down.`} unavailable={!next} accessibleName={`Move ${l.label} down`} calls={next ? swapOrder(l, next, false, linkInput, 'admin_save_travel_link') : []} />
                    <DeleteLinkFlow link={l} />
                  </>
                }
              />
            );
          })}
        </RecordList>
        <LinkFlow allowedHosts={allowedHosts} nextSort={nextLinkSort} variant="ghost" label={links.length ? 'Add another link' : 'Add a link'} />
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>Search providers, the sites links may point at, and the saved rows. For troubleshooting; nothing here needs changing by hand.</Note>
          {providers ? (
            (['flights', 'hotels'] as const).map((kind) => {
              const p = providers[kind];
              return (
                <div key={kind}>
                  <p className="con-caption con-caption--standalone">{kind === 'flights' ? 'Flight search' : 'Hotel search'}</p>
                  <KeyValues
                    items={[
                      { label: 'Adapter', value: `${p.name} · mode ${p.mode}` },
                      { label: 'Can', value: Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing' },
                      { label: 'Configuration', value: p.config.missing.length ? `missing ${p.config.missing.join(', ')}` : 'complete' },
                    ]}
                  />
                  {p.config.warnings.map((w) => (
                    <Note key={w}>{w}</Note>
                  ))}
                </div>
              );
            })
          ) : (
            <Note>Provider status needs the integrations entitlement.</Note>
          )}
          <KeyValues items={[{ label: 'Links may point at', value: allowedHosts.join(', ') }]} />
          <DataTable
            caption="Hotels, as saved"
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Name</th>
                <th scope="col">Order</th>
                <th scope="col">Version</th>
                <th scope="col">Source</th>
                <th scope="col">Checked</th>
                <th scope="col">Freshness</th>
              </tr>
            }
          >
            {hotels.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>{h.name}</td>
                <td>{h.sortOrder}</td>
                <td>{h.synthesized ? 'not saved' : h.contentVersion}</td>
                <td>{h.sourceId ?? '—'}</td>
                <td>
                  <Day at={h.verifiedAt} />
                </td>
                <td>{h.freshness}</td>
              </tr>
            ))}
          </DataTable>
          <DataTable
            caption="Links, as saved"
            empty={links.length ? null : 'None saved.'}
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Category</th>
                <th scope="col">Order</th>
                <th scope="col">URL</th>
                <th scope="col">Checked</th>
              </tr>
            }
          >
            {links.map((l) => (
              <tr key={l.id}>
                <td>{l.id}</td>
                <td>{l.category}</td>
                <td>{l.sortOrder}</td>
                <td className="ops-code">{l.url}</td>
                <td>
                  <Day at={l.verifiedAt} />
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}

function HotelMeta({ hotel: h }: { hotel: HotelRecommendation }) {
  const parts: string[] = [];
  if (h.address) parts.push(h.address);
  if (h.walkMinutesToVenue !== null) parts.push(h.walkMinutesToVenue === 0 ? 'at the venue' : `${h.walkMinutesToVenue} min walk`);
  if (h.priceBand) parts.push(`price band ${h.priceBand}`);
  if (!h.isVenue) return <>{parts.join(' · ') || 'No details yet'}</>;
  const b = h.block;
  return (
    <>
      {parts.length ? `${parts.join(' · ')} · ` : ''}
      {b?.url ? 'block link set' : 'no block link yet'}
      {b?.rateText ? ` · ${b.rateText}` : ''}
      {b?.cutoff ? (
        <>
          {' '}
          · book by <time dateTime={b.cutoff}>{CALENDAR_DAY.format(new Date(`${b.cutoff}T00:00:00Z`))}</time>
        </>
      ) : null}
    </>
  );
}

/** A calendar date (YYYY-MM-DD) read as written: `Day` would move it into Chicago time, a day early. */
const CALENDAR_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' });

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
