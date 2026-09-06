import type { Metadata } from 'next';
import { useId, type ReactNode } from 'react';
import { noticeFor } from '@/app/(public)/travel/_shared/recipe';
import { currentPrincipal, runAsUi } from '@/app/(public)/travel/_shared/server';
import { adminGetTravelConfig } from '@/capabilities/travel';
import { newId } from '@/contracts/ids';
import { HOTEL_REASON_KINDS, PRICE_BANDS, TRAVEL_LINK_CATEGORIES } from '@/db/schema/travel';
import type { HotelRecommendation, TravelLink } from '@/domain/travel';
import { removeHotelAction, removeLinkAction, saveHotelAction, saveLinkAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Travel (admin)', robots: { index: false, follow: false } };

const INPUT = 'mt-1 block w-full min-h-11 rounded-sm border border-primary/40 bg-neutral px-3 py-2 text-base';
const BUTTON = 'inline-flex min-h-11 items-center rounded-sm border border-primary px-4 py-2 text-base font-medium';
const PRIMARY = `${BUTTON} bg-primary text-neutral`;

function Text({ name, label, value, type = 'text', hint }: { name: string; label: string; value?: string | number | null; type?: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-sm text-primary/70">{hint}</p> : null}
      <input id={id} name={name} type={type} defaultValue={value ?? ''} className={INPUT} />
    </div>
  );
}

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-base">
      <input type="checkbox" name={name} defaultChecked={checked} className="h-5 w-5" />
      {label}
    </label>
  );
}

function HotelForm({ hotel }: { hotel?: HotelRecommendation }) {
  const block = hotel?.block ?? null;
  const isVenue = hotel?.isVenue ?? false;
  return (
    <form action={saveHotelAction} className="grid grid-cols-1 gap-3 rounded-sm border border-primary/20 p-4 sm:grid-cols-2">
      <input type="hidden" name="idempotencyKey" value={newId()} />
      {hotel ? <input type="hidden" name="id" value={hotel.id} /> : null}
      <h3 className="text-lg font-semibold sm:col-span-2">{hotel ? `${hotel.name}${hotel.synthesized ? ' (from the brief; not saved yet)' : ` · v${hotel.contentVersion}`}` : 'Add a hotel'}</h3>
      <Text name="name" label="Name" value={hotel?.name} />
      <Text name="address" label="Address" value={hotel?.address} />
      <Text name="sortOrder" label="Sort order" type="number" value={hotel?.sortOrder ?? 100} />
      <Text name="walkMinutesToVenue" label="Walk minutes to the CAA" type="number" value={hotel?.walkMinutesToVenue} />
      <div>
        <label htmlFor={`band-${hotel?.id ?? 'new'}`} className="block text-sm font-medium">
          Price band
        </label>
        <select id={`band-${hotel?.id ?? 'new'}`} name="priceBand" defaultValue={hotel?.priceBand ?? ''} className={INPUT}>
          <option value="">Unknown</option>
          {PRICE_BANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <Text name="sourceId" label="Source id (provenance)" value={hotel?.sourceId} />
      <Text name="websiteUrl" label="Website URL (allowlisted host)" value={hotel?.websiteUrl} />
      <Text name="bookingUrl" label="Booking URL (allowlisted host)" value={hotel?.bookingUrl} />
      <div className="sm:col-span-2">
        <label htmlFor={`reasons-${hotel?.id ?? 'new'}`} className="block text-sm font-medium">
          Reasons, one per line: kind | text | value
        </label>
        <p className="text-sm text-primary/70">Kinds: {HOTEL_REASON_KINDS.join(', ')}. Objective only; never safety claims.</p>
        <textarea id={`reasons-${hotel?.id ?? 'new'}`} name="reasons" rows={4} defaultValue={(hotel?.reasons ?? []).map((r) => [r.kind, r.text, r.value ?? ''].join(' | ')).join('\n')} className={INPUT} />
      </div>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <Check name="isVenue" label="This is the venue hotel (holds the room block)" checked={isVenue} />
        <Check name="placeholder" label="Details still to confirm (shows TODO)" checked={hotel?.placeholder ?? false} />
        <Check name="active" label="Show to guests" checked={hotel?.active ?? true} />
      </div>
      <fieldset className="grid grid-cols-1 gap-3 border-t border-primary/20 pt-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="text-base font-semibold">Room block (venue hotel only)</legend>
        <Text name="blockUrl" label="Block booking URL (allowlisted host)" value={block?.url} />
        <Text name="blockCode" label="Booking code" value={block?.code} />
        <Text name="blockRateText" label="Rate text shown to guests" value={block?.rateText} hint="Exactly as the planner confirms it, e.g. “$xxx/night + tax”." />
        <Text name="blockCutoff" label="Cutoff (YYYY-MM-DD)" type="date" value={block?.cutoff} />
        <Text name="blockCheckIn" label="Block check-in" type="date" value={block?.checkIn} />
        <Text name="blockCheckOut" label="Block check-out" type="date" value={block?.checkOut} />
        <div className="sm:col-span-2">
          <Text name="blockNote" label="Note" value={block?.note} />
        </div>
        <Check name="blockPlaceholder" label="Block details are still placeholders" checked={block?.placeholder ?? true} />
      </fieldset>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" className={PRIMARY}>
          {hotel ? 'Save hotel' : 'Add hotel'}
        </button>
      </div>
    </form>
  );
}

function LinkRow({ link }: { link: TravelLink }) {
  return (
    <li className="flex flex-col gap-2 rounded-sm border border-primary/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">
          {link.label} <span className="text-sm text-primary/70">({link.category} · {link.provider}{link.active ? '' : ' · hidden'})</span>
        </p>
        <p className="break-all text-sm">{link.url}</p>
      </div>
      <form action={removeLinkAction}>
        <input type="hidden" name="id" value={link.id} />
        <input type="hidden" name="idempotencyKey" value={newId()} />
        <button type="submit" className={BUTTON}>
          Remove
        </button>
      </form>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-primary/20 py-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export default async function AdminTravelPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { principal } = await currentPrincipal();
  if (principal.kind !== 'admin') {
    return (
      <main id="main" className="mx-auto max-w-[60rem] px-4 py-10">
        <h1 className="text-3xl font-semibold">Travel (admin)</h1>
        <p className="mt-3">Administrator sign-in is required.</p>
      </main>
    );
  }
  const config = await runAsUi(adminGetTravelConfig, {});
  if (!config.ok) {
    return (
      <main id="main" className="mx-auto max-w-[60rem] px-4 py-10">
        <h1 className="text-3xl font-semibold">Travel (admin)</h1>
        <p className="mt-3">{config.error.message}</p>
      </main>
    );
  }
  const { providers, hotels, links, allowedHosts } = config.value.data;
  const notice = noticeFor(sp.notice);
  return (
    <main id="main" className="mx-auto max-w-[60rem] px-4 pb-16 pt-10">
      <h1 className="text-3xl font-semibold">Travel (admin)</h1>
      <p className="mt-2 text-primary/80">Provider status, the room block, curated hotels, and partner links. Links must point at: {allowedHosts.join(', ')}.</p>
      {notice ? (
        <p role="status" className="mt-4 rounded-sm border border-primary/40 p-3">
          {notice}
        </p>
      ) : null}

      <Section title="Providers">
        {providers ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(['flights', 'hotels'] as const).map((kind) => {
              const p = providers[kind];
              return (
                <div key={kind} className="rounded-sm border border-primary/20 p-4">
                  <dt className="font-semibold capitalize">{kind}</dt>
                  <dd className="mt-1 text-sm">
                    <p>
                      {p.name} · mode {p.mode}
                    </p>
                    <p>Can: {Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}</p>
                    {p.config.missing.length ? <p>Missing: {p.config.missing.join(', ')}</p> : <p>Configuration complete.</p>}
                    {p.config.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p>Provider status needs the integrations entitlement.</p>
        )}
      </Section>

      <Section title="Venue room block and curated hotels">
        {hotels.map((h) => (
          <div key={h.id} className="flex flex-col gap-2">
            <HotelForm hotel={h} />
            {!h.synthesized ? (
              <form action={removeHotelAction}>
                <input type="hidden" name="id" value={h.id} />
                <input type="hidden" name="idempotencyKey" value={newId()} />
                <button type="submit" className={BUTTON}>
                  Remove {h.name}
                </button>
              </form>
            ) : null}
          </div>
        ))}
        <HotelForm />
      </Section>

      <Section title="Airline / OTA / hotel / transit links">
        {links.length ? (
          <ul className="flex flex-col gap-2">
            {links.map((l) => (
              <LinkRow key={l.id} link={l} />
            ))}
          </ul>
        ) : (
          <p>No partner links yet. They appear on Travel &amp; Stay and as the fallback when live search is unavailable.</p>
        )}
        <form action={saveLinkAction} className="grid grid-cols-1 gap-3 rounded-sm border border-primary/20 p-4 sm:grid-cols-2">
          <input type="hidden" name="idempotencyKey" value={newId()} />
          <h3 className="text-lg font-semibold sm:col-span-2">Add a link</h3>
          <div>
            <label htmlFor="link-category" className="block text-sm font-medium">
              Category
            </label>
            <select id="link-category" name="category" className={INPUT} defaultValue="airline">
              {TRAVEL_LINK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Text name="provider" label="Provider name (shown on the button)" />
          <Text name="label" label="Label" />
          <Text name="url" label="URL (https, allowlisted host)" type="url" />
          <Text name="note" label="Disclosure / note" />
          <Text name="sortOrder" label="Sort order" type="number" value={100} />
          <div className="sm:col-span-2">
            <Check name="active" label="Show to guests" checked />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={PRIMARY}>
              Add link
            </button>
          </div>
        </form>
      </Section>
    </main>
  );
}
