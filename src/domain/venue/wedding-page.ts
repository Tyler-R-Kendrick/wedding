import type { CapabilityContext } from '@/contracts/capability';
import type { Citation } from '@/contracts/provenance';
import { invoke } from '@/capabilities/invoke';
import { siteStatus } from '@/capabilities/site_status';
import { BRIEF_VERIFIED_AT, SOURCE_KEYS } from '@/content/sources';
import { toProvenanceView } from '@/domain/content/provenance';
import { textBlock } from '@/domain/content/text';
import type { HandoffView, ProvenanceViewData, TextBlockView, WeddingEventView } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { assertAllowedRedirect } from '@/lib/redirects';
import { getProvider } from '@/providers/registry';
import { weddingEventSkeleton } from './wedding-events';

export interface WeddingPageData {
  route: string;
  coupleDisplayName: string;
  dateIso: string;
  venueName: string;
  venueAddress: string;
  venueUrl: string | null;
  directions?: HandoffView;
  events: WeddingEventView[];
  dressCode: TextBlockView;
  roomsNote: TextBlockView;
  provenance: ProvenanceViewData;
  sources: Citation[];
}

/**
 * The Wedding page: facts from `site_status` (couple, date, venue), the venue directions
 * handoff, and the events skeleton whose times and rooms are typed placeholders (P-01, P-02).
 */
export async function getWeddingPageData(ctx: CapabilityContext): Promise<WeddingPageData | undefined> {
  const status = await invoke(siteStatus, ctx, {});
  if (!status.ok) return undefined;
  const { wedding } = status.value.data;
  const provenance = toProvenanceView(
    { sourceId: SOURCE_KEYS.brief, sourceType: 'authored', sourceUrl: null, verifiedAt: new Date(BRIEF_VERIFIED_AT), validFrom: null, validUntil: null, trustClass: 'TRUSTED_WEDDING', contentVersion: 1, editedBy: 'seed:brief-2026-09-04' },
    { route: ROUTES.wedding, now: ctx.now, sources: new Map([[SOURCE_KEYS.brief, "Sara + Tyler's brief"]]) },
  );
  const events = weddingEventSkeleton(provenance, wedding.date);
  const maps = getProvider('maps');
  const url = maps.directionsUrl({ name: wedding.venueName, address: wedding.venueAddress }, { mode: 'transit' });
  const directions: HandoffView | undefined = assertAllowedRedirect(url).ok
    ? { provider: 'google-maps', label: 'Open directions in Google Maps', url, disclosure: `You will leave our site for Google Maps to get directions to ${wedding.venueName}.`, opensNewTab: true }
    : undefined;
  return {
    route: ROUTES.wedding,
    coupleDisplayName: wedding.coupleDisplayName,
    dateIso: wedding.date,
    venueName: wedding.venueName,
    venueAddress: wedding.venueAddress,
    venueUrl: wedding.venueUrl,
    ...(directions ? { directions } : {}),
    events,
    dressCode: events[0]!.dressCode,
    roomsNote: textBlock('TODO(Tyler & Sara): which of the four kit spaces hosts each part of the day is not confirmed (backlog P-01). Explore CAA describes the candidates.'),
    provenance,
    sources: status.value.sources,
  };
}
