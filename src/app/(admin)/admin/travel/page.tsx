import type { Metadata } from 'next';
import { noticeFor } from '@/app/(public)/travel/_shared/recipe';
import { currentPrincipal, runAsUi } from '@/app/(public)/travel/_shared/server';
import { adminGetTravelConfig } from '@/capabilities/travel';
import { HOTEL_REASON_KINDS, PRICE_BANDS, TRAVEL_LINK_CATEGORIES } from '@/db/schema/travel';
import type { HotelRecommendation, TravelLink } from '@/domain/travel';
import { ConsoleGate, ConsolePage, Denied, KeyValues, Note, Section } from '../_components/console';
import { Button, Checkbox, IdemKey, Input } from '../_components/ops';
import { removeHotelAction, removeLinkAction, saveHotelAction, saveLinkAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Travel (admin)', robots: { index: false, follow: false } };

/**
 * Travel and stay — on the admin console shell.
 *
 * This page was written in Tailwind utilities against three local constants (`INPUT`, `BUTTON`,
 * `PRIMARY`) and its own `Section`, `Text` and `Check` components: a sixth admin design, complete
 * with its own field markup and its own idea of a heading. Every one of those has a console
 * equivalent, so the local copies are gone and the constants with them.
 */
function HotelForm({ hotel }: { hotel?: HotelRecommendation }) {
  const block = hotel?.block ?? null;
  const key = hotel?.id ?? 'new';
  return (
    <form action={saveHotelAction} className="ops-form con-panel">
      <IdemKey />
      {hotel ? <input type="hidden" name="id" value={hotel.id} /> : null}
      <h3>{hotel ? `${hotel.name}${hotel.synthesized ? ' (from the brief; not saved yet)' : ` · v${hotel.contentVersion}`}` : 'Add a hotel'}</h3>
      <Input id={`name-${key}`} name="name" label="Name" defaultValue={hotel?.name ?? ''} />
      <Input id={`address-${key}`} name="address" label="Address" defaultValue={hotel?.address ?? ''} />
      <Input id={`sort-${key}`} name="sortOrder" label="Sort order" type="number" defaultValue={String(hotel?.sortOrder ?? 100)} />
      <Input id={`walk-${key}`} name="walkMinutesToVenue" label="Walk minutes to the CAA" type="number" defaultValue={hotel?.walkMinutesToVenue == null ? '' : String(hotel.walkMinutesToVenue)} />
      <Input id={`band-${key}`} name="priceBand" label="Price band" defaultValue={hotel?.priceBand ?? ''} options={[{ value: '', label: 'Unknown' }, ...PRICE_BANDS.map((b) => ({ value: b, label: b }))]} />
      <Input id={`source-${key}`} name="sourceId" label="Source id (provenance)" defaultValue={hotel?.sourceId ?? ''} />
      <Input id={`site-${key}`} name="websiteUrl" label="Website URL (allowlisted host)" defaultValue={hotel?.websiteUrl ?? ''} />
      <Input id={`booking-${key}`} name="bookingUrl" label="Booking URL (allowlisted host)" defaultValue={hotel?.bookingUrl ?? ''} />
      <Input
        id={`reasons-${key}`}
        name="reasons"
        label="Reasons, one per line: kind | text | value"
        type="textarea"
        hint={`Kinds: ${HOTEL_REASON_KINDS.join(', ')}. Objective only; never safety claims.`}
        defaultValue={(hotel?.reasons ?? []).map((r) => [r.kind, r.text, r.value ?? ''].join(' | ')).join('\n')}
      />
      <Checkbox id={`isVenue-${key}`} name="isVenue" label="This is the venue hotel (holds the room block)" defaultChecked={hotel?.isVenue ?? false} />
      <Checkbox id={`placeholder-${key}`} name="placeholder" label="Details still to confirm (shows TODO)" defaultChecked={hotel?.placeholder ?? false} />
      <Checkbox id={`active-${key}`} name="active" label="Show to guests" defaultChecked={hotel?.active ?? true} />
      <fieldset className="ops-field">
        <legend>Room block (venue hotel only)</legend>
        <Input id={`blockUrl-${key}`} name="blockUrl" label="Block booking URL (allowlisted host)" defaultValue={block?.url ?? ''} />
        <Input id={`blockCode-${key}`} name="blockCode" label="Booking code" defaultValue={block?.code ?? ''} />
        <Input id={`blockRate-${key}`} name="blockRateText" label="Rate text shown to guests" defaultValue={block?.rateText ?? ''} hint="Exactly as the planner confirms it, e.g. “$xxx/night + tax”." />
        <Input id={`blockCutoff-${key}`} name="blockCutoff" label="Cutoff (YYYY-MM-DD)" type="date" defaultValue={block?.cutoff ?? ''} />
        <Input id={`blockIn-${key}`} name="blockCheckIn" label="Block check-in" type="date" defaultValue={block?.checkIn ?? ''} />
        <Input id={`blockOut-${key}`} name="blockCheckOut" label="Block check-out" type="date" defaultValue={block?.checkOut ?? ''} />
        <Input id={`blockNote-${key}`} name="blockNote" label="Note" defaultValue={block?.note ?? ''} />
        <Checkbox id={`blockPlaceholder-${key}`} name="blockPlaceholder" label="Block details are still placeholders" defaultChecked={block?.placeholder ?? true} />
      </fieldset>
      <div className="ops-form-inline">
        <Button>{hotel ? 'Save hotel' : 'Add hotel'}</Button>
      </div>
    </form>
  );
}

function LinkRow({ link }: { link: TravelLink }) {
  return (
    <li className="con-panel">
      <p>
        {link.label}{' '}
        <span className="con-index__blurb">
          ({link.category} · {link.provider}
          {link.active ? '' : ' · hidden'})
        </span>
      </p>
      <p className="ops-code">{link.url}</p>
      <form action={removeLinkAction} className="ops-form-inline">
        <input type="hidden" name="id" value={link.id} />
        <IdemKey />
        <Button variant="danger">Remove</Button>
      </form>
    </li>
  );
}

export default async function AdminTravelPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { principal } = await currentPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Travel and stay" />;
  const config = await runAsUi(adminGetTravelConfig, {});
  if (!config.ok) {
    return (
      <ConsolePage title="Travel (admin)">
        <Denied message={config.error.message} />
      </ConsolePage>
    );
  }
  const { providers, hotels, links, allowedHosts } = config.value.data;
  const notice = noticeFor(sp.notice);
  return (
    <ConsolePage
      title="Travel (admin)"
      lede={`Provider status, the room block, curated hotels, and partner links. Links must point at: ${allowedHosts.join(', ')}.`}
      notice={notice ? { ok: notice } : undefined}
    >
      <Section title="Providers" id="providers">
        {providers ? (
          (['flights', 'hotels'] as const).map((kind) => {
            const p = providers[kind];
            return (
              <div key={kind} className="con-panel">
                <h3>{kind}</h3>
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
      </Section>

      <Section title="Venue room block and curated hotels" id="hotels">
        {hotels.map((h) => (
          <div key={h.id}>
            <HotelForm hotel={h} />
            {!h.synthesized ? (
              <form action={removeHotelAction} className="ops-form-inline">
                <input type="hidden" name="id" value={h.id} />
                <IdemKey />
                <Button variant="danger">Remove {h.name}</Button>
              </form>
            ) : null}
          </div>
        ))}
        <HotelForm />
      </Section>

      <Section title="Airline / OTA / hotel / transit links" id="links">
        {links.length ? (
          <ul className="list list--plain con-index__list">
            {links.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        ) : (
          <Note>No partner links yet. They appear on Travel &amp; Stay and as the fallback when live search is unavailable.</Note>
        )}
        <form action={saveLinkAction} className="ops-form con-panel">
          <IdemKey />
          <h3>Add a link</h3>
          <Input id="link-category" name="category" label="Category" defaultValue="airline" options={TRAVEL_LINK_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Input id="link-provider" name="provider" label="Provider name (shown on the button)" />
          <Input id="link-label" name="label" label="Label" />
          <Input id="link-url" name="url" label="URL (https, allowlisted host)" type="url" />
          <Input id="link-note" name="note" label="Disclosure / note" />
          <Input id="link-sort" name="sortOrder" label="Sort order" type="number" defaultValue="100" />
          <Checkbox id="link-active" name="active" label="Show to guests" defaultChecked />
          <div className="ops-form-inline">
            <Button>Add link</Button>
          </div>
        </form>
      </Section>
    </ConsolePage>
  );
}
