'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences, GuestPreview, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';

interface Values extends Record<string, unknown> {
  url: string;
  checkedUrl: string;
  provider: string;
  providerName: string;
  host: string;
  confirmed: boolean;
  kind: 'registry' | 'adventure-fund';
  label: string;
  note: string;
}

export interface RegistryLinkSummary {
  id: string;
  kind: 'registry' | 'adventure-fund';
  provider: string;
  label: string;
  url: string;
  note: string | null;
  sortOrder: number;
  /** A hidden link stays hidden when its words are changed: showing it is its own, explicit action. */
  active: boolean;
}

interface CheckedLink {
  kind: 'link';
  provider: string;
  providerName: string;
  host: string;
  url: string;
}

/**
 * Link a registry, in three steps: paste the link, open it and confirm it is yours, then say how
 * guests should see it.
 *
 * There is no registry API behind this, and the flow does not pretend otherwise. Zola, The Knot and
 * Joy keep the list, take the purchases and mark what has been bought; none of them offers a public
 * way for another site to read a couple's registry. What this site can do is send guests to the
 * right page — so the step that matters is the second one, where the couple open the exact link a
 * guest will be sent to and say it is theirs. That confirmation is what `verifiedAt` records.
 */
export function RegistryFlow({ existing, takenIds, variant = 'primary', label, accessibleName }: { existing?: RegistryLinkSummary; takenIds: string[]; variant?: 'primary' | 'ghost' | 'quiet'; label: string; accessibleName?: string }) {
  const initial: Values = {
    url: existing?.url ?? '',
    checkedUrl: '',
    provider: existing?.provider ?? '',
    providerName: '',
    host: '',
    confirmed: false,
    kind: existing?.kind ?? 'registry',
    label: existing?.label ?? '',
    note: existing?.note ?? '',
  };

  const steps: FlowStep<Values>[] = [
    {
      title: 'Paste the link',
      lede: 'Open your registry on Zola, The Knot or Joy, press its Share button, and paste the link it gives you.',
      fields: ['url'],
      render: (ctx) => <TextField ctx={ctx} name="url" label="Link to your registry" type="url" inputMode="url" spellCheck={false} hint="It starts with https:// and names your registry site, for example zola.com/registry/…" />,
      ready: (v) => v.url.trim().length > 0,
      readyHint: { field: 'url', message: 'Paste the link to your registry.' },
      next: async (v) => {
        const res = await callCapability<CheckedLink>('admin_check_gift_setup', { input: { kind: 'link', url: v.url } });
        if (!res.ok || !res.data) return { errors: { url: res.error?.message ?? 'We could not check that link. Please try again.' } };
        const d = res.data;
        const changed = d.url !== v.checkedUrl;
        return {
          patch: {
            checkedUrl: d.url,
            provider: d.provider,
            providerName: d.providerName,
            host: d.host,
            // A different link has not been opened yet, whatever was ticked for the last one.
            confirmed: changed ? false : v.confirmed,
            label: v.label || `Our registry on ${d.providerName}`,
          },
        };
      },
    },
    {
      title: 'Check it is yours',
      lede: 'Guests will be sent to exactly this page. Open it and make sure it shows your names and your list.',
      fields: ['confirmed'],
      render: (ctx) => (
        <>
          <div className="flow-found">
            <p className="flow-found__what">
              A <strong>{ctx.values.providerName}</strong> link
            </p>
            <p className="flow-found__url">{ctx.values.checkedUrl}</p>
            <p>
              <a className="ops-button ops-button-ghost flow-inline-button" href={ctx.values.checkedUrl} target="_blank" rel="noopener noreferrer">
                Open it in a new tab<span aria-hidden="true"> ↗</span>
              </a>
            </p>
          </div>
          <CheckField ctx={ctx} name="confirmed" label="I opened it, and it is our registry." hint="Your registry site keeps the list and knows what has been bought. This site only sends guests to it." />
        </>
      ),
      ready: (v) => v.confirmed,
      readyHint: { field: 'confirmed', message: 'Open the link and tick the box once you have seen it is yours.' },
    },
    {
      title: 'How guests see it',
      fields: ['kind', 'label', 'note'],
      render: (ctx) => (
        <>
          <ChoiceField
            ctx={ctx}
            name="kind"
            legend="Where it goes on the Gifts page"
            choices={[
              { value: 'registry', label: 'Our wishlist', description: 'Things for our home, chosen from the list.' },
              { value: 'adventure-fund', label: 'Our next adventures', description: 'A honeymoon or experience fund kept on the registry site.' },
            ]}
          />
          <TextField ctx={ctx} name="label" label="What the link says" hint="Guests read it as a heading and on the button." />
          <TextField ctx={ctx} name="note" label="A line under it" optional hint="For example: “Kitchen things and a few books.”" />
          <GuestPreview>
            <div className="gs-card-preview">
              <div className="gs-card-preview__head">
                <span className="gs-card-preview__title">{ctx.values.label || 'Our registry'}</span>
                <span className="gs-card-preview__via">via {ctx.values.providerName || 'your registry'}</span>
              </div>
              {ctx.values.note ? <p className="gs-card-preview__note">{ctx.values.note}</p> : null}
              <span className="gs-card-preview__button">
                {ctx.values.label || 'Our registry'}
                <span aria-hidden="true"> ↗</span>
              </span>
            </div>
          </GuestPreview>
        </>
      ),
      ready: (v) => v.label.trim().length > 0,
      readyHint: { field: 'label', message: 'Give the link a few words guests will see.' },
    },
  ];

  return (
    <AdminFlow<Values>
      id={`gifts:registry:${existing?.id ?? 'new'}`}
      title={existing ? `Edit ${existing.label}` : 'Link your registry'}
      trigger={{ label, variant, accessibleName }}
      initial={initial}
      steps={steps}
      submit={{
        label: existing ? 'Save registry link' : 'Add to the Gifts page',
        capability: 'admin_upsert_gift_link',
        success: existing && !existing.active ? 'Saved. It is still hidden from guests; use Show when you want it back.' : 'Saved. Guests see it on the Gifts page now.',
        input: (v) => ({
          id: existing?.id ?? freeId(`${v.kind === 'registry' ? 'wishlist' : 'adventures'}-${v.provider || 'link'}`, takenIds),
          kind: v.kind,
          provider: v.provider || undefined,
          label: v.label.trim(),
          url: v.checkedUrl || v.url,
          note: v.note.trim() || undefined,
          sortOrder: existing?.sortOrder ?? 0,
          placeholder: false,
          active: existing?.active ?? true,
          confirmed: v.confirmed,
        }),
      }}
    />
  );
}

/**
 * Takes a registry or next-adventures link off the Gifts page for good. Hide (one click on the row)
 * is the reversible choice. `lastShown`: it is the only link of its kind guests can see.
 */
export function DeleteRegistryFlow({ link, where, lastShown }: { link: Pick<RegistryLinkSummary, 'id' | 'kind' | 'label'>; where: string; lastShown: boolean }) {
  const empty = link.kind === 'registry' ? 'Guests read that you have not chosen where to keep a wishlist yet' : 'Guests no longer see this under your next adventures';
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`gifts:delete-link:${link.id}`}
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
                <p>
                  The Gifts page stops sending guests to {where}.{lastShown ? ` It is the only one guests can see: ${empty} until you add another.` : ''}
                </p>
                <p>Your registry itself, and anything already bought from it, stays on {where}; only the link here goes. This cannot be undone. To take it off the page for a while, use Hide instead.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, delete ${link.label}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Delete ${link.label}`, capability: 'admin_delete_gift_link', success: `${link.label} deleted.`, input: () => ({ id: link.id }) }}
    />
  );
}

/** A slug nobody has used: `wishlist-zola`, then `wishlist-zola-2`. */
function freeId(base: string, taken: string[]): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'link';
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`;
}
