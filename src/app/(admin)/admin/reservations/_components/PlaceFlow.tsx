'use client';

import { AdminFlow, type FieldErrors, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, GuestPreview, TextField } from '@/components/admin/flow/fields';
import { assertAllowedRedirect } from '@/lib/redirects';

/** A saved place, or one of the built-in placeholders being set up for real. */
export interface PlaceRecord {
  id: string;
  name: string;
  resySlug: string | null;
  openTableId: string | null;
  url: string | null;
  note: string | null;
  placeholder: boolean;
  active: boolean;
  sortOrder: number;
  /** Not asked about in the flow; sent back as it is. */
  placeRef?: string | null;
}

interface Values extends Record<string, unknown> {
  name: string;
  note: string;
  placeholder: boolean;
  resySlug: string;
  openTableId: string;
  url: string;
  confirmed: boolean;
}

const VENUE_SLUG = /^[a-z0-9-]{1,80}$/;

/** What a guest's button opens, in the order the site prefers them: Resy, then OpenTable, then the place's own page. */
function bookingLinks(v: Values): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (v.resySlug.trim()) out.push({ label: 'Resy', url: `https://resy.com/cities/chi/${v.resySlug.trim()}` });
  if (v.openTableId.trim()) out.push({ label: 'OpenTable', url: `https://www.opentable.com/r/${v.openTableId.trim()}` });
  if (v.url.trim()) out.push({ label: 'Their booking page', url: v.url.trim() });
  return out;
}

/**
 * Add a place guests can reserve at, or change one: what it is, how guests book it, then open the
 * booking page they will be sent to and say it is the right one.
 *
 * The form this replaces asked for an "Id (slug)", an "Order" of 0 to 1000, a "Still a placeholder"
 * box and an "Active" box. The id is made from the name; order is Up and Down on the list; showing
 * and hiding is one click on the row.
 */
export function PlaceFlow({
  place,
  takenIds,
  nextSort = 0,
  replacesDefaults = false,
  label,
  variant = 'primary',
  accessibleName,
}: {
  place?: PlaceRecord;
  takenIds: string[];
  nextSort?: number;
  /** Nothing is saved yet: saving this replaces the built-in placeholders guests see. */
  replacesDefaults?: boolean;
  label: string;
  variant?: 'primary' | 'ghost' | 'quiet';
  accessibleName?: string;
}) {
  const initial: Values = {
    name: place?.name ?? '',
    note: place?.note ?? '',
    placeholder: place?.placeholder ?? false,
    resySlug: place?.resySlug ?? '',
    openTableId: place?.openTableId ?? '',
    url: place?.url ?? '',
    confirmed: false,
  };

  const steps: FlowStep<Values>[] = [
    {
      title: 'The place',
      fields: ['name', 'note', 'placeholder'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="name" label="Name" hint="As guests know it: “Cindy’s, the rooftop at the Chicago Athletic Association”." />
          <TextField ctx={ctx} name="note" label="A note for guests" optional multiline rows={2} hint="Why you like it, or what to book: “Ask for a table by the window.”" />
          <CheckField ctx={ctx} name="placeholder" label="Some of this is still to be confirmed" hint="Guests see that you are still writing the details." />
        </>
      ),
      ready: (v) => v.name.trim().length > 0,
      readyHint: { field: 'name', message: 'Enter the place’s name.' },
    },
    {
      title: 'How guests book',
      lede: 'Fill in whichever the place uses. Leave all three empty if it cannot be booked online: guests are told to ask you.',
      fields: ['resySlug', 'openTableId', 'url'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="resySlug" label="Resy" optional spellCheck={false} hint="The last part of its Resy address: resy.com/cities/chi/…" />
          <TextField ctx={ctx} name="openTableId" label="OpenTable" optional spellCheck={false} hint="The last part of its OpenTable address: opentable.com/r/…" />
          <TextField ctx={ctx} name="url" label="Its own booking page" type="url" inputMode="url" spellCheck={false} optional hint="Only if it takes bookings on a site this one links to, such as the hotel’s." />
        </>
      ),
      next: async (v) => {
        const errors: FieldErrors = {};
        const patch: Partial<Values> = {};
        for (const f of ['resySlug', 'openTableId'] as const) {
          const raw = v[f].trim().split(/[?#]/)[0]!.replace(/\/+$/, '').replace(/^.*\//, '').toLowerCase();
          if (!raw) continue;
          if (VENUE_SLUG.test(raw)) patch[f] = raw;
          else errors[f] = 'Use just the last part of the address: lowercase letters, numbers and dashes.';
        }
        if (v.url.trim()) {
          const r = assertAllowedRedirect(v.url.trim());
          if (r.ok) patch.url = r.value.toString();
          else errors.url = r.error.message;
        }
        if (Object.keys(errors).length) return { errors };
        // Different links have not been opened yet, whatever was ticked for the last ones.
        const changed = (['resySlug', 'openTableId', 'url'] as const).some((f) => (patch[f] ?? v[f]) !== initial[f]);
        return { patch: { ...patch, confirmed: changed ? false : v.confirmed } };
      },
    },
    {
      title: 'Check and save',
      fields: ['confirmed'],
      render: (ctx) => {
        const links = bookingLinks(ctx.values);
        return (
          <>
            {links.length ? (
              <div className="flow-found">
                <p>Guests are sent to exactly {links.length === 1 ? 'this page' : 'the first of these'}. Open {links.length === 1 ? 'it' : 'each'} and check it is {ctx.values.name || 'the right place'}.</p>
                {links.map((l) => (
                  <p key={l.url}>
                    <a className="ops-button ops-button-ghost flow-inline-button" href={l.url} target="_blank" rel="noopener noreferrer">
                      Open {l.label}
                      <span aria-hidden="true"> ↗</span>
                      <span className="sr-only"> (new tab)</span>
                    </a>{' '}
                    <span className="flow-found__url">{l.url}</span>
                  </p>
                ))}
              </div>
            ) : null}
            <GuestPreview>
              <p className="flow-copy">
                <strong>{ctx.values.name}</strong>
              </p>
              {ctx.values.note ? <p className="flow-copy">{ctx.values.note}</p> : null}
              <p className="flow-copy">{links.length ? `A button to reserve on ${links[0]!.label === 'Their booking page' ? 'their own site' : links[0]!.label}.` : 'No button: guests read that it cannot be booked here yet, and how to ask you.'}</p>
            </GuestPreview>
            {replacesDefaults ? <p className="flow-hint">This is the first place you save, so guests stop seeing the built-in placeholders: from now on they see only the places you add.</p> : null}
            {links.length ? <CheckField ctx={ctx} name="confirmed" label="I opened the booking page, and it is this place." /> : null}
          </>
        );
      },
      ready: (v) => v.confirmed || bookingLinks(v).length === 0,
      readyHint: { field: 'confirmed', message: 'Open the booking page, then tick the box once you have seen it is right.' },
    },
  ];

  return (
    <AdminFlow<Values>
      id={`reservations:place:${place?.id ?? 'new'}`}
      title={place ? `${replacesDefaults ? 'Set up' : 'Edit'} ${place.name}` : 'Add a place to reserve'}
      trigger={{ label, variant, accessibleName }}
      initial={initial}
      steps={steps}
      submit={{
        label: place ? 'Save place' : 'Add a place',
        capability: 'admin_upsert_reservation_venue',
        success: place ? `${place.name} saved.` : 'Place added.',
        input: (v) => ({
          id: place?.id ?? freeId(v.name, takenIds),
          name: v.name.trim(),
          placeRef: place?.placeRef ?? undefined,
          note: v.note.trim() || undefined,
          resySlug: v.resySlug.trim() || undefined,
          openTableId: v.openTableId.trim() || undefined,
          url: v.url.trim() || undefined,
          placeholder: v.placeholder,
          active: place?.active ?? true,
          sortOrder: place?.sortOrder ?? nextSort,
          // Ticking "I opened it" is the check; a place with no link has nothing to check.
          verifiedAt: v.confirmed ? new Date().toISOString() : undefined,
        }),
      }}
    />
  );
}

/** A slug nobody has used, made from the name: `cindys-rooftop`, then `cindys-rooftop-2`. */
function freeId(name: string, taken: string[]): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56)
      .replace(/-+$/, '') || 'place';
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`;
}
