'use client';

import { AdminFlow, type FieldErrors, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences, GuestPreview, ReviewList, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';
import type { HotelRecommendation } from '@/domain/travel';
import { checkLink } from './travel-input';

/** What a row carries: enough to name the flow. The full record is fetched when the sheet opens. */
export interface HotelSummary {
  id: string;
  name: string;
  isVenue: boolean;
  synthesized: boolean;
}

type Reason = HotelRecommendation['reasons'][number];

interface Values extends Record<string, unknown> {
  name: string;
  address: string;
  walkMinutesToVenue: string;
  priceBand: string;
  websiteUrl: string;
  bookingUrl: string;
  reasons: string;
  placeholder: boolean;
  blockUrl: string;
  blockCode: string;
  blockRateText: string;
  blockCutoff: string;
  blockCheckIn: string;
  blockCheckOut: string;
  blockNote: string;
  blockPlaceholder: boolean;
  /** Carried through unchanged: none of these is asked about in the flow. */
  sortOrder: number;
  active: boolean;
  sourceId: string;
  blockPending: string;
  /** The saved reasons, so a line kept as it was keeps its kind and figure. */
  savedReasons: Reason[];
}

const EMPTY: Values = {
  name: '',
  address: '',
  walkMinutesToVenue: '',
  priceBand: '',
  websiteUrl: '',
  bookingUrl: '',
  reasons: '',
  placeholder: false,
  blockUrl: '',
  blockCode: '',
  blockRateText: '',
  blockCutoff: '',
  blockCheckIn: '',
  blockCheckOut: '',
  blockNote: '',
  blockPlaceholder: true,
  sortOrder: 100,
  active: true,
  sourceId: '',
  blockPending: '',
  savedReasons: [],
};

const PRICE_CHOICES = [
  { value: '', label: 'Not sure yet', description: 'Guests see no price band.' },
  { value: '$', label: '$', description: 'Budget.' },
  { value: '$$', label: '$$', description: 'Moderate.' },
  { value: '$$$', label: '$$$', description: 'Upscale.' },
  { value: '$$$$', label: '$$$$', description: 'Luxury.' },
];

function fromRecord(h: HotelRecommendation): Partial<Values> {
  const b = h.block;
  return {
    name: h.name,
    address: h.address ?? '',
    walkMinutesToVenue: h.walkMinutesToVenue === null ? '' : String(h.walkMinutesToVenue),
    priceBand: h.priceBand ?? '',
    websiteUrl: h.websiteUrl ?? '',
    bookingUrl: h.bookingUrl ?? '',
    reasons: h.reasons.map((r) => r.text).join('\n'),
    placeholder: h.placeholder,
    blockUrl: b?.url ?? '',
    blockCode: b?.code ?? '',
    blockRateText: b?.rateText ?? '',
    blockCutoff: b?.cutoff ?? '',
    blockCheckIn: b?.checkIn ?? '',
    blockCheckOut: b?.checkOut ?? '',
    blockNote: b?.note ?? '',
    blockPlaceholder: b?.placeholder ?? true,
    sortOrder: h.sortOrder,
    active: h.active,
    sourceId: h.sourceId ?? '',
    blockPending: b?.pending ?? '',
    savedReasons: h.reasons,
  };
}

/** One reason per line. A line that was already saved keeps its kind; a new one is filed as "other". */
function parseReasons(v: Values): Reason[] {
  return v.reasons
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => v.savedReasons.find((r) => r.text === text) ?? { kind: 'other' as const, text });
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/**
 * Add a hotel, or change one (the venue's included): where it is, why you recommend it, and — for
 * the venue — the room block, then the card guests will read.
 *
 * It replaces a form printed out once per hotel, all open at once down the page, which asked for a
 * "Sort order", a "Source id (provenance)", reasons typed as `kind | text | value`, and an "is the
 * venue" box that only one hotel can ever have. Which hotel is the venue is decided by the row the
 * flow is opened from; order is Up and Down on the list; reasons are plain sentences.
 */
export function HotelFlow({
  hotel,
  venue = hotel?.isVenue ?? false,
  allowedHosts,
  nextSort = 100,
  label,
  variant = 'primary',
  accessibleName,
}: {
  hotel?: HotelSummary;
  venue?: boolean;
  allowedHosts: string[];
  /** Where a new hotel goes: after the last one. */
  nextSort?: number;
  label: string;
  variant?: 'primary' | 'ghost' | 'quiet';
  accessibleName?: string;
}) {
  const load = hotel
    ? async () => {
        const res = await callCapability<{ hotels: HotelRecommendation[] }>('admin_get_travel_config', { input: {} });
        if (!res.ok || !res.data) return res.error?.message ?? 'The hotel could not be read.';
        const h = res.data.hotels.find((x) => x.id === hotel.id);
        return h ? fromRecord(h) : 'That hotel is no longer saved. Close this and reload the page.';
      }
    : undefined;

  const linkErrors = (v: Values, fields: ('websiteUrl' | 'bookingUrl' | 'blockUrl')[]) => {
    const errors: FieldErrors = {};
    const patch: Partial<Values> = {};
    for (const f of fields) {
      if (!v[f].trim()) continue;
      const r = checkLink(v[f], allowedHosts);
      if (r.ok) patch[f] = r.url;
      else errors[f] = r.message;
    }
    return Object.keys(errors).length ? { errors } : { patch };
  };

  const steps: FlowStep<Values>[] = [
    {
      title: 'The hotel',
      lede: venue ? 'The venue hotel: where the wedding is, and where the room block is held.' : 'A hotel near the venue you would send a friend to.',
      fields: ['name', 'address', 'walkMinutesToVenue', 'priceBand'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="name" label="Name" />
          <TextField ctx={ctx} name="address" label="Street address" optional hint="Guests get it as a map link." />
          <TextField ctx={ctx} name="walkMinutesToVenue" label="Minutes on foot to the Chicago Athletic Association" type="number" min={0} max={180} optional hint="A whole number. 0 for the venue itself." />
          <ChoiceField ctx={ctx} name="priceBand" legend="Price band" choices={PRICE_CHOICES} />
        </>
      ),
      ready: (v) => v.name.trim().length > 0,
      readyHint: { field: 'name', message: 'Enter the hotel’s name.' },
      next: async (v) => {
        const w = v.walkMinutesToVenue.trim();
        if (w && !(Number.isInteger(Number(w)) && Number(w) >= 0 && Number(w) <= 180)) return { errors: { walkMinutesToVenue: 'Enter a whole number of minutes from 0 to 180, or leave it empty.' } };
        return undefined;
      },
    },
    ...(venue
      ? [
          {
            title: 'The room block',
            lede: 'Exactly as the hotel or your planner confirmed it. Leave anything you do not have yet empty.',
            fields: ['blockUrl', 'blockCode', 'blockRateText', 'blockCutoff', 'blockCheckIn', 'blockCheckOut', 'blockNote', 'blockPlaceholder'],
            render: (ctx) => (
              <>
                <TextField ctx={ctx} name="blockUrl" label="Link to book in the block" type="url" inputMode="url" spellCheck={false} optional hint="The group booking page the hotel gave you. It starts with https://." />
                <TextField ctx={ctx} name="blockCode" label="Booking code" optional spellCheck={false} />
                <TextField ctx={ctx} name="blockRateText" label="The rate, as guests should read it" optional hint="For example: “$289 a night plus tax”." />
                <TextField ctx={ctx} name="blockCutoff" label="Book by" type="date" optional hint="The last day guests can book at the block rate." />
                <TextField ctx={ctx} name="blockCheckIn" label="Block starts (check-in)" type="date" optional />
                <TextField ctx={ctx} name="blockCheckOut" label="Block ends (check-out)" type="date" optional />
                <TextField ctx={ctx} name="blockNote" label="A note for guests" optional multiline rows={2} />
                <CheckField ctx={ctx} name="blockPlaceholder" label="These block details are not confirmed yet" hint="Guests are told the block link is not live yet, and are sent to the hotel’s own site." />
              </>
            ),
            next: async (v: Values) => {
              const r = linkErrors(v, ['blockUrl']);
              if (r.errors) return r;
              if (v.blockCheckIn && v.blockCheckOut && v.blockCheckOut <= v.blockCheckIn) return { errors: { blockCheckOut: 'The block has to end after it starts.' } };
              return r;
            },
          } satisfies FlowStep<Values>,
        ]
      : []),
    {
      title: 'Links and reasons',
      fields: ['websiteUrl', 'bookingUrl', 'reasons'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="websiteUrl" label="The hotel’s website" type="url" inputMode="url" spellCheck={false} optional hint={`It has to be on the list of sites this one links to: ${allowedHosts.join(', ')}.`} />
          <TextField ctx={ctx} name="bookingUrl" label="Where to book" type="url" inputMode="url" spellCheck={false} optional hint="If guests book somewhere other than the website. The button uses this one when both are set." />
          <TextField
            ctx={ctx}
            name="reasons"
            label="Why you recommend it"
            multiline
            rows={4}
            optional
            hint="One reason per line, up to eight. Facts a guest can check (“Six minutes’ walk”, “Family suites”), never promises about safety."
          />
        </>
      ),
      next: async (v) => {
        const lines = v.reasons.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length > 8) return { errors: { reasons: `That is ${lines.length} reasons; guests see at most eight. Keep the eight that matter most.` } };
        const long = lines.findIndex((l) => l.length > 160);
        if (long >= 0) return { errors: { reasons: `Reason ${long + 1} is longer than 160 characters. Say it more briefly.` } };
        return linkErrors(v, ['websiteUrl', 'bookingUrl']);
      },
    },
    {
      title: 'Check and save',
      fields: ['placeholder'],
      render: (ctx) => {
        const v = ctx.values;
        const reasons = parseReasons(v);
        const link = v.bookingUrl || v.websiteUrl;
        return (
          <>
            {venue ? (
              <ReviewList
                items={[
                  { label: 'Block link', value: v.blockUrl },
                  { label: 'Booking code', value: v.blockCode },
                  { label: 'Rate', value: v.blockRateText },
                  { label: 'Book by', value: v.blockCutoff },
                  { label: 'Dates', value: v.blockCheckIn || v.blockCheckOut ? `${v.blockCheckIn || '?'} to ${v.blockCheckOut || '?'}` : '' },
                  { label: 'Confirmed', value: v.blockPlaceholder ? 'Not yet' : 'Yes' },
                ]}
              />
            ) : null}
            <GuestPreview>
              <p className="flow-copy">
                <strong>{v.name || 'The hotel'}</strong>
              </p>
              {v.address ? <p className="flow-copy">{v.address}</p> : null}
              {v.walkMinutesToVenue || v.priceBand ? (
                <p className="flow-copy">{[v.walkMinutesToVenue ? `${v.walkMinutesToVenue} min walk to the CAA` : '', v.priceBand ? `Price band ${v.priceBand}` : ''].filter(Boolean).join(' · ')}</p>
              ) : null}
              {reasons.length ? (
                <ul>
                  {reasons.map((r) => (
                    <li key={r.text}>{r.text}</li>
                  ))}
                </ul>
              ) : null}
              {v.placeholder ? <p className="flow-copy">A note that you are still writing the details for this one.</p> : null}
              {link ? <p className="flow-copy">A button: {v.bookingUrl ? `Book ${v.name}` : `Visit ${v.name}`}, to {safeHost(link)}.</p> : <p className="flow-copy">No button: there is no link to send guests to.</p>}
            </GuestPreview>
            <CheckField ctx={ctx} name="placeholder" label="Some of these details are still to be confirmed" hint="Guests see a note that you are still writing this one." />
          </>
        );
      },
    },
  ];

  return (
    <AdminFlow<Values>
      id={`travel:hotel:${hotel?.id ?? 'new'}`}
      title={hotel ? (hotel.synthesized ? `Set up ${hotel.name}` : `Change ${hotel.name}`) : 'Add a hotel'}
      trigger={{ label, variant, accessibleName }}
      initial={{ ...EMPTY, sortOrder: nextSort }}
      load={load}
      steps={steps}
      submit={{
        label: hotel ? 'Save hotel' : 'Add hotel',
        capability: 'admin_save_hotel',
        success: hotel ? `${hotel.name} saved.` : 'Hotel added. Guests see it on Travel & Stay.',
        input: (v) => ({
          id: hotel?.id,
          name: v.name.trim(),
          address: orNull(v.address),
          isVenue: venue,
          sortOrder: v.sortOrder,
          reasons: parseReasons(v),
          priceBand: v.priceBand || null,
          walkMinutesToVenue: v.walkMinutesToVenue.trim() ? Number(v.walkMinutesToVenue) : null,
          websiteUrl: orNull(v.websiteUrl),
          bookingUrl: orNull(v.bookingUrl),
          block: venue
            ? {
                url: orNull(v.blockUrl),
                code: orNull(v.blockCode),
                rateText: orNull(v.blockRateText),
                checkIn: v.blockCheckIn || null,
                checkOut: v.blockCheckOut || null,
                cutoff: v.blockCutoff || null,
                note: orNull(v.blockNote),
                pending: orNull(v.blockPending),
                placeholder: v.blockPlaceholder,
              }
            : null,
          placeholder: v.placeholder,
          active: v.active,
          sourceId: orNull(v.sourceId),
        }),
      }}
    />
  );
}

/** Takes a hotel off Travel & Stay for good. Hiding it (a one-click Hide on the row) is the reversible choice. */
export function RemoveHotelFlow({ hotel }: { hotel: HotelSummary }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`travel:remove-hotel:${hotel.id}`}
      tone="danger"
      title={`Remove ${hotel.name}`}
      trigger={{ label: 'Remove', variant: 'danger', accessibleName: `Remove ${hotel.name}` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Remove ${hotel.name}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  {hotel.name} comes off Travel &amp; Stay, with its reasons and links.
                  {hotel.isVenue ? ' Guests see the placeholder room block from the brief again until you set the venue hotel up.' : ''}
                </p>
                <p>This cannot be undone; adding it again starts from nothing. To take it off the page for a while, use Hide instead.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, remove ${hotel.name}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Remove ${hotel.name}`, capability: 'admin_remove_hotel', success: `${hotel.name} removed.`, input: () => ({ hotelId: hotel.id }) }}
    />
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
