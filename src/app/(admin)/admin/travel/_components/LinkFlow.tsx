'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences, GuestPreview, TextField } from '@/components/admin/flow/fields';
import type { TravelLink } from '@/domain/travel';
import { checkLink, LINK_CATEGORIES } from './travel-input';

interface Values extends Record<string, unknown> {
  url: string;
  /** The link as the check normalised it: what is opened on step 2 and what is saved. */
  checkedUrl: string;
  confirmed: boolean;
  category: string;
  provider: string;
  label: string;
  note: string;
}


/**
 * Add a partner link, or change one: paste it, open it to check it is the page you mean, then say
 * how guests see it. The link is checked against the trusted-partner list on the step it was pasted,
 * with the list in words, instead of after a full form was submitted.
 */
export function LinkFlow({ link, allowedHosts, nextSort = 100, label, variant = 'primary', accessibleName }: { link?: TravelLink; allowedHosts: string[]; nextSort?: number; label: string; variant?: 'primary' | 'ghost' | 'quiet'; accessibleName?: string }) {
  const initial: Values = {
    url: link?.url ?? '',
    checkedUrl: '',
    confirmed: false,
    category: link?.category ?? 'airline',
    provider: link?.provider ?? '',
    label: link?.label ?? '',
    note: link?.note ?? '',
  };

  const steps: FlowStep<Values>[] = [
    {
      title: 'Paste the link',
      lede: 'Open the page on the airline, booking site or hotel, and copy the address from the top of the browser.',
      fields: ['url'],
      render: (ctx) => <TextField ctx={ctx} name="url" label="Link" type="url" inputMode="url" spellCheck={false} hint={`It starts with https://. This site only links to: ${allowedHosts.join(', ')}.`} />,
      ready: (v) => v.url.trim().length > 0,
      readyHint: { field: 'url', message: 'Paste the link first.' },
      next: async (v) => {
        const r = checkLink(v.url, allowedHosts);
        if (!r.ok) return { errors: { url: r.message } };
        const changed = r.url !== v.checkedUrl;
        return { patch: { checkedUrl: r.url, confirmed: changed ? false : v.confirmed, provider: v.provider || r.host } };
      },
    },
    {
      title: 'Check it goes to the right page',
      lede: 'Guests will be sent to exactly this address.',
      fields: ['confirmed'],
      render: (ctx) => (
        <>
          <div className="flow-found">
            <p className="flow-found__url">{ctx.values.checkedUrl}</p>
            <p>
              <a className="ops-button ops-button-ghost flow-inline-button" href={ctx.values.checkedUrl} target="_blank" rel="noopener noreferrer">
                Open it in a new tab<span aria-hidden="true"> ↗</span>
              </a>
            </p>
          </div>
          <CheckField ctx={ctx} name="confirmed" label="I opened it, and it is the page I mean." />
        </>
      ),
      ready: (v) => v.confirmed,
      readyHint: { field: 'confirmed', message: 'Open the link, then tick the box once you have seen it is right.' },
    },
    {
      title: 'How guests see it',
      fields: ['category', 'provider', 'label', 'note'],
      render: (ctx) => (
        <>
          <ChoiceField ctx={ctx} name="category" legend="What kind of link" choices={LINK_CATEGORIES.map((c) => ({ ...c, description: c.description || undefined }))} />
          <TextField ctx={ctx} name="provider" label="Who it goes to" hint="The name guests know: “Skyscanner”, “Hyatt”." />
          <TextField ctx={ctx} name="label" label="What the link says" hint="For example: “Flights to Chicago”." />
          <TextField ctx={ctx} name="note" label="A line under it" optional hint="Anything guests should know before they click, such as a discount code or that you earn nothing from it." />
          <GuestPreview>
            <p className="flow-copy">
              <strong>{ctx.values.label || 'The link'}</strong> <span className="flow-optional">via {ctx.values.provider || 'the partner'}</span>
            </p>
            {ctx.values.note ? <p className="flow-copy">{ctx.values.note}</p> : null}
          </GuestPreview>
        </>
      ),
      ready: (v) => v.provider.trim().length > 0 && v.label.trim().length > 0,
      readyHint: { field: 'label', message: 'Say who it goes to and what the link says.' },
    },
  ];

  return (
    <AdminFlow<Values>
      id={`travel:link:${link?.id ?? 'new'}`}
      title={link ? `Edit ${link.label}` : 'Add a travel link'}
      trigger={{ label, variant, accessibleName }}
      initial={initial}
      steps={steps}
      submit={{
        label: link ? 'Save link' : 'Add a link',
        capability: 'admin_save_travel_link',
        success: link ? 'Link saved.' : 'Link added. Guests see it on Travel & Stay.',
        input: (v) => ({
          id: link?.id,
          category: v.category,
          provider: v.provider.trim(),
          label: v.label.trim(),
          url: v.checkedUrl || v.url.trim(),
          note: v.note.trim() || null,
          sortOrder: link?.sortOrder ?? nextSort,
          active: link?.active ?? true,
        }),
      }}
    />
  );
}

/** Deletes a partner link. Hiding it is the reversible choice, one click on the row. */
export function DeleteLinkFlow({ link }: { link: TravelLink }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`travel:delete-link:${link.id}`}
      tone="danger"
      title={`Delete ${link.label}`}
      trigger={{ label: 'Delete', variant: 'danger', accessibleName: `Delete ${link.label}` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Delete ${link.label}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>The link to {link.provider} comes off Travel &amp; Stay, and is no longer offered when live search is unavailable. This cannot be undone; to take it off for a while, use Hide instead.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, delete ${link.label}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Delete ${link.label}`, capability: 'admin_remove_travel_link', success: `${link.label} deleted.`, input: () => ({ linkId: link.id }) }}
    />
  );
}
