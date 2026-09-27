'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, GuestPreview, TextField } from '@/components/admin/flow/fields';

export interface FundSummary {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  origin: 'default' | 'admin';
}

interface Values extends Record<string, unknown> {
  title: string;
  description: string;
  shown: boolean;
}

/**
 * Add a fund, or change what one says. Two steps: the words, then the card as a guest will see it.
 *
 * The id is made from the title for a new fund and never shown: it was the first field of the old
 * form ("Id (slug)"), and the only way to edit a fund was to retype its id exactly.
 */
export function FundFlow({ fund, takenIds, label, variant = 'primary', rails }: { fund?: FundSummary; takenIds: string[]; label: string; variant?: 'primary' | 'ghost' | 'quiet'; rails: string[] }) {
  const initial: Values = { title: fund?.title ?? '', description: fund?.description ?? '', shown: fund?.active ?? true };
  const steps: FlowStep<Values>[] = [
    {
      title: 'The words',
      lede: 'Say what the money is for, the way you would say it to a friend. Leave amounts out: the site never suggests one.',
      fields: ['title', 'description'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="title" label="What it is for" hint="For example: “Our honeymoon”." />
          <TextField ctx={ctx} name="description" label="One line about it" optional hint="For example: “Toward the first trip of our married life.”" />
        </>
      ),
      ready: (v) => v.title.trim().length > 0,
      readyHint: { field: 'title', message: 'Say what the money is for.' },
    },
    {
      title: 'Check and save',
      fields: ['shown'],
      render: (ctx) => (
        <>
          <GuestPreview>
            <p className="gs-card-preview__title">{ctx.values.title}</p>
            {ctx.values.description ? <p className="gs-card-preview__note">{ctx.values.description}</p> : null}
            {rails.length ? (
              <p className="gs-card-preview__buttons">
                {rails.map((r) => (
                  <span key={r} className="gs-card-preview__button gs-card-preview__button--quiet">
                    Give with {r}
                    <span aria-hidden="true"> ↗</span>
                  </span>
                ))}
              </p>
            ) : (
              <p className="flow-hint">The buttons for Venmo, PayPal and the rest appear here once you add a way to give.</p>
            )}
          </GuestPreview>
          <CheckField ctx={ctx} name="shown" label="Show this fund to guests" />
        </>
      ),
    },
  ];
  return (
    <AdminFlow<Values>
      id={`gifts:fund:${fund?.id ?? 'new'}`}
      title={fund ? `Change “${fund.title}”` : 'Add a fund'}
      trigger={{ label, variant }}
      initial={initial}
      steps={steps}
      submit={{
        label: 'Save',
        capability: 'admin_upsert_gift_fund',
        success: 'Saved.',
        input: (v) => ({
          id: fund?.id ?? freeSlug(v.title, takenIds),
          title: v.title.trim(),
          // Always sent: an emptied line clears it, which is what the preview on the last step showed.
          description: v.description.trim(),
          active: v.shown,
        }),
      }}
    />
  );
}

function freeSlug(title: string, taken: string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'fund';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}
