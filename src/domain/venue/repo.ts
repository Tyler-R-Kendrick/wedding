import { asc, eq } from 'drizzle-orm';
import type { Citation } from '@/contracts/provenance';
import { operationalFields, venueFacts, venueSpaces, type OperationalFieldRow, type VenueFactRow, type VenueSpaceRow } from '@/db/schema';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { optionalText, textBlock } from '@/domain/content/text';
import type { OperationalFieldView, VenueFactView, VenueSpaceView } from '@/domain/content/views';
import { canSeeExpired, filterVisible, isValidAt } from '@/domain/content/visibility';
import { ROUTES } from '@/domain/routes';

const HISTORY_ROUTE = `${ROUTES.exploreCaa}#history`;
const LOOK_ROUTE = `${ROUTES.exploreCaa}#look-for-this`;
const OUTLETS_ROUTE = `${ROUTES.exploreCaa}#outlets`;
const GETTING_HERE_ROUTE = `${ROUTES.exploreCaa}#getting-here`;

export const operationalRoute = (row: Pick<OperationalFieldRow, 'kind'>) => (row.kind === 'outlet' || row.kind === 'amenity' ? OUTLETS_ROUTE : GETTING_HERE_ROUTE);

export function toOperationalFieldView(row: OperationalFieldRow, ctx: ReadContext): OperationalFieldView {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    label: row.label,
    value: row.value,
    url: row.url && /^https:\/\//.test(row.url) ? row.url : null,
    note: optionalText(row.note),
    placeholder: row.placeholder,
    expired: !isValidAt(row, ctx.now),
    provenance: toProvenanceView(row, { route: operationalRoute(row), sources: ctx.sources, now: ctx.now }),
  };
}

export function toVenueSpaceView(row: VenueSpaceRow, ctx: ReadContext): VenueSpaceView {
  const route = `${ROUTES.exploreCaa}/${row.slug}`;
  return {
    id: row.id,
    slug: row.slug,
    href: route,
    name: row.name,
    character: row.character,
    features: row.features,
    capacities: row.capacities,
    lookForThis: row.lookForThis,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

export function toVenueFactView(row: VenueFactRow, ctx: ReadContext): VenueFactView {
  const route = row.category === 'look-for-this' ? LOOK_ROUTE : HISTORY_ROUTE;
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    statement: row.statement,
    ...(row.note ? { note: row.note } : {}),
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

/** The typed placeholder every venue page must show until the planner confirms the rooms (backlog P-01). */
export const ROOMS_NOT_CONFIRMED = textBlock('TODO(Tyler & Sara): which room hosts the ceremony, the cocktail hour, and the reception is not confirmed (backlog P-01). The spaces below are the candidates from the venue kit.');

export interface VenueFactsOptions {
  category?: VenueFactRow['category'];
  /** Admin UI only: include expired/not-yet-valid operational records (rendered as such). */
  includeExpired?: boolean;
}

export async function getVenueFacts(ctx: ReadContext, opts: VenueFactsOptions = {}) {
  const includeExpired = opts.includeExpired === true && canSeeExpired(ctx.principal, ctx.surface);
  const [factRows, spaceRows, opRows] = await Promise.all([
    ctx.db.select().from(venueFacts).orderBy(asc(venueFacts.order)),
    ctx.db.select().from(venueSpaces).orderBy(asc(venueSpaces.order)),
    ctx.db.select().from(operationalFields).orderBy(asc(operationalFields.order)),
  ]);
  const facts = filterVisible(factRows, ctx.principal, ctx.surface, ctx.now).filter((f) => !opts.category || f.category === opts.category);
  const spaces = filterVisible(spaceRows, ctx.principal, ctx.surface, ctx.now);
  const operational = filterVisible(opRows, ctx.principal, ctx.surface, ctx.now, { includeExpired });
  const outlets = operational.filter((o) => o.kind === 'outlet' || o.kind === 'amenity');
  const gettingHere = operational.filter((o) => o.kind !== 'outlet' && o.kind !== 'amenity');
  const sources = dedupeCitations([
    ...facts.map((f) => toRecordCitation(f, { route: f.category === 'look-for-this' ? LOOK_ROUTE : HISTORY_ROUTE, title: `Explore CAA › ${f.statement}`, recordRef: { type: 'venue_facts', id: f.id }, now: ctx.now })),
    ...spaces.map((s) => toRecordCitation(s, { route: `${ROUTES.exploreCaa}/${s.slug}`, title: `Explore CAA › ${s.name}`, recordRef: { type: 'venue_spaces', id: s.id }, now: ctx.now })),
    ...operational.map((o) => toRecordCitation(o, { route: operationalRoute(o), title: `Explore CAA › ${o.label}`, recordRef: { type: 'operational_fields', id: o.id }, now: ctx.now })),
  ]);
  return {
    history: facts.filter((f) => f.category !== 'look-for-this').map((f) => toVenueFactView(f, ctx)),
    lookForThis: facts.filter((f) => f.category === 'look-for-this').map((f) => toVenueFactView(f, ctx)),
    spaces: spaces.map((s) => toVenueSpaceView(s, ctx)),
    outlets: outlets.map((o) => toOperationalFieldView(o, ctx)),
    gettingHere: gettingHere.map((o) => toOperationalFieldView(o, ctx)),
    roomsNotConfirmed: ROOMS_NOT_CONFIRMED,
    sources,
  };
}

export async function getVenueSpace(ctx: ReadContext, slug: string): Promise<{ space: VenueSpaceView; sources: Citation[] } | undefined> {
  const rows = await ctx.db.select().from(venueSpaces).where(eq(venueSpaces.slug, slug)).limit(1);
  const row = rows[0];
  if (!row || filterVisible([row], ctx.principal, ctx.surface, ctx.now).length === 0) return undefined;
  return {
    space: toVenueSpaceView(row, ctx),
    sources: [toRecordCitation(row, { route: `${ROUTES.exploreCaa}/${row.slug}`, title: `Explore CAA › ${row.name}`, recordRef: { type: 'venue_spaces', id: row.id }, now: ctx.now })],
  };
}

export async function listOperationalFields(ctx: ReadContext, opts: { kind?: OperationalFieldRow['kind']; includeExpired?: boolean } = {}) {
  const includeExpired = opts.includeExpired === true && canSeeExpired(ctx.principal, ctx.surface);
  const rows = await ctx.db.select().from(operationalFields).orderBy(asc(operationalFields.order));
  return filterVisible(rows, ctx.principal, ctx.surface, ctx.now, { includeExpired })
    .filter((o) => !opts.kind || o.kind === opts.kind)
    .map((o) => toOperationalFieldView(o, ctx));
}
