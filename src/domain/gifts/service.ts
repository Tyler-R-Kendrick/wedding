import { placeholderHint } from '@/components/provenance/Placeholder';
import { isPlaceholderText } from '@/content/schemas';
import type { Db } from '@/db/client';
import type { GiftLinkKind } from '@/db/schema';
import type { CashFundProvider, GiftLink, RegistryProvider } from '@/providers/registry/types';
import { toGuestHandoff, type GuestHandoff } from '../external/handoff';
import { listGiftLinkRows } from './repo';

export interface GiftLinkView extends GuestHandoff {
  id: string;
  kind: GiftLinkKind;
  note: string | null;
  /** True for TODO(Tyler & Sara) placeholders: rendered as editorial placeholders, never as facts. */
  placeholder: boolean;
  /** Where the link came from: admin configuration (database), environment, or the built-in placeholder. */
  origin: 'admin' | 'configured' | 'placeholder';
  verifiedAt: string | null;
}

/**
 * The authoring marker classifies a link; it is never what a guest reads.
 *
 * A link's label is rendered twice on the public gifts page — as the hand-off card's `<h3>` and as
 * the button a guest clicks — so a label configured as `TODO(Tyler & Sara): registry link` printed
 * the marker to visitors. `placeholder: true` is what carries the meaning: `ExternalHandoffCard`
 * turns it into the editorial sentence naming who is still writing. Strip the marker for display
 * and keep the hint, exactly as `Text`/`Paragraphs` do for content blocks.
 */
const guestLabel = (label: string) => (isPlaceholderText(label) ? placeholderHint(label) : label);

function fromProvider(kind: GiftLinkKind, provider: RegistryProvider | CashFundProvider, links: GiftLink[]): GiftLinkView[] {
  const out: GiftLinkView[] = [];
  for (const l of links) {
    const handoff = toGuestHandoff({ ...l, label: guestLabel(l.label) });
    if (!handoff.ok) continue; // never hand a guest a link off the allowlist, whatever the configuration says
    const placeholder = provider.mode === 'mock' || isPlaceholderText(l.label);
    out.push({ ...handoff.value, id: l.id, kind, note: l.note ?? null, placeholder, origin: placeholder ? 'placeholder' : 'configured', verifiedAt: null });
  }
  return out;
}

/**
 * Registry + "next adventures" links, in ladder order: admin-configured rows (database) win
 * per kind, then environment-configured links, then the built-in TODO placeholders. Every URL
 * is re-validated against the redirect allowlist at read time.
 */
export async function listGiftLinks(db: Db, providers: { registry: RegistryProvider; cashFund: CashFundProvider }): Promise<GiftLinkView[]> {
  const rows = await listGiftLinkRows(db);
  const admin: GiftLinkView[] = [];
  for (const r of rows) {
    const handoff = toGuestHandoff({ provider: r.provider, label: guestLabel(r.label), url: r.url, opensNewTab: true, disclosure: r.disclosure ?? defaultDisclosure(r.kind) });
    if (!handoff.ok) continue;
    admin.push({ ...handoff.value, id: r.id, kind: r.kind, note: r.note, placeholder: r.placeholder, origin: 'admin', verifiedAt: r.verifiedAt?.toISOString() ?? null });
  }
  const out: GiftLinkView[] = [];
  for (const kind of ['registry', 'adventure-fund'] as const) {
    const fromAdmin = admin.filter((l) => l.kind === kind);
    if (fromAdmin.length) {
      out.push(...fromAdmin);
      continue;
    }
    const provider = kind === 'registry' ? providers.registry : providers.cashFund;
    out.push(...fromProvider(kind, provider, await provider.describeLinks()));
  }
  return out;
}

export function defaultDisclosure(kind: GiftLinkKind): string {
  return kind === 'registry'
    ? 'You will leave our site to the registry provider. Purchases happen there; we never see payment details.'
    : 'You will leave our site to the gift provider. Gifts are handled there; we never see payment details.';
}
