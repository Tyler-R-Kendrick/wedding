import { href, INTERNAL_ROUTES, PAGES, type SitemapPage } from '@wedding/sitemap';
import adventuresJson from '@/content/seed/adventures.json' with { type: 'json' };
import recommendationsJson from '@/content/seed/recommendations.json' with { type: 'json' };
import venueSpacesJson from '@/content/seed/venue-spaces.json' with { type: 'json' };
import { CONTENT_TABLE_NAMES } from '@/domain/content/admin';
import { DEFAULT_COLLECTIONS } from '@/domain/media/collections';
import { REDIRECTS } from '@/lib/site-redirects';
import { seedId } from '@/db/seed/sources';
import { THEME_IDS } from '@/themes/registry';

/**
 * One inventory of every endpoint the wedding app serves.
 *
 * The human doc (`docs/sitemap.md`), the admin sitemap, `/sitemap.xml` and the e2e crawler all
 * read this module. Page rows come from `@wedding/sitemap` (the pipeline's page list). Dynamic
 * examples come from the content seed and the fixture steps — never an invented slug, and never a
 * real invitation token (`/i/example` only).
 *
 * `/sitemap.xml` lists audience `public` only. Lifecycle `visibleFrom` is not applied: it decides
 * when a page joins the navigation, not whether the route exists. The URLs are stable across
 * states (a later state may still show a coming-soon treatment). Guest, gate, admin, internal
 * theme trees, APIs and redirects are omitted. Dynamic public routes are expanded with seed rows
 * whose visibility is `public`; the pipeline placeholder `/example` is not a real page and is not
 * listed. Guest-only recommendations stay off the public sitemap because an anonymous visitor is
 * not shown them.
 */

type SeedRow = { slug: string; visibility?: string };

const publicSlugs = (rows: readonly SeedRow[]) => rows.filter((r) => r.visibility === 'public').map((r) => r.slug);

export const PUBLIC_ADVENTURE_SLUGS = publicSlugs(adventuresJson as SeedRow[]);
export const PUBLIC_RECOMMENDATION_SLUGS = publicSlugs(recommendationsJson as SeedRow[]);
export const PUBLIC_VENUE_SLUGS = publicSlugs(venueSpacesJson as SeedRow[]);

/** First seeded story section. The content editor's row route needs a real id; this one is in the seed. */
export const SEEDED_STORY_ROW_ID = seedId(200);

/** RSVP parts the app actually routes (`src/components/rsvp/RsvpTaskList.tsx`). */
export const RSVP_STEP_PATHS = ['/rsvp/attending', '/rsvp/guest', '/rsvp/meals', '/rsvp/notes'] as const;

/**
 * Concrete paths quoted so `scripts/test-server-specs.mjs` can see them when it warms the crawler.
 * Dynamic routes compile on the first of these; the rest of a pattern is the same page.
 */
export const CRAWL_EXAMPLES = {
  adventure: '/our-adventures/starved-rock',
  recommendation: '/share-an-adventure/starved-rock-state-park',
  venue: '/our-venue/white-city-ballroom',
  rsvpStep: '/rsvp/attending',
  photo: '/photos/guest-uploads',
  invitation: '/i/example',
  invite: '/invite/example',
  theme: '/t/botanical-deco',
  preview: '/t/botanical-deco/preview/RSVP_OPEN',
  contentTable: '/admin/content/story_sections',
  contentNew: '/admin/content/story_sections/new',
  contentRow: `/admin/content/story_sections/${SEEDED_STORY_ROW_ID}`,
  sitemapXml: '/sitemap.xml',
} as const;

export const CONTENT_TABLE_PATHS = [
  '/admin/content/story_sections',
  '/admin/content/timeline_moments',
  '/admin/content/places',
  '/admin/content/adventure_memories',
  '/admin/content/recommendations',
  '/admin/content/itinerary_templates',
  '/admin/content/venue_spaces',
  '/admin/content/venue_facts',
  '/admin/content/operational_fields',
  '/admin/content/faq_entries',
] as const;

export type InventoryAudience = 'public' | 'guest' | 'gate' | 'admin' | 'api';
export type InventoryKind = 'page' | 'api' | 'redirect' | 'internal' | 'export';

export interface InventoryRow {
  /** Route pattern, or the concrete path when the route is not dynamic. */
  url: string;
  /** Concrete paths a person can request. One entry when the route is static. */
  examples: readonly string[];
  /** The example the crawler opens. Null when the row is not an HTML visit. */
  crawlExample: string | null;
  audience: InventoryAudience;
  method: string;
  purpose: string;
  expected: string;
  kind: InventoryKind;
  /** Open this row in a browser during the crawler (HTML). */
  crawl: boolean;
  /** Anonymous GET whose status the crawler checks without rendering. */
  probe: number | null;
}

export type CrawlPersonaKind = 'anonymous' | 'guest' | 'admin' | 'view-role';

const pageExpected = (p: SitemapPage): string => {
  switch (p.audience) {
    case 'public':
      return '200 for any visitor. Lifecycle may hide it from the nav before visibleFrom; the route still answers.';
    case 'guest':
      return p.id === 'rsvp-step'
        ? '200 when that part applies to the signed-in household. 404 when it does not (a household with no plus-one has no /rsvp/guest). Signed out: the guests-only gate, not a 404.'
        : '200. Signed out: a sign-in or guests-only gate (the route exists). Signed-in guest: the household page. An administrator sees the gate on pages that are the guest’s own reply.';
    case 'gate':
      return p.id === 'invitation'
        ? 'Redirects to /invite/<token> (the long link). /i/example is the only token this inventory names.'
        : p.id === 'invite'
          ? '200. A real token previews the household and offers claim; it never starts a session. /invite/example is unknown and shows recovery, not a 404 and not a session.'
          : '200. The door into a session. Signing out is a form; it does not end the session until submitted.';
    case 'admin':
      return '200 for an administrator. Anyone else gets the administrator sign-in gate (200 HTML), not a 404.';
    default:
      return '200.';
  }
};

function examplesFor(p: SitemapPage): readonly string[] {
  switch (p.id) {
    case 'adventure':
      return PUBLIC_ADVENTURE_SLUGS.map((s) => `/our-adventures/${s}`);
    case 'share-item':
      return PUBLIC_RECOMMENDATION_SLUGS.map((s) => `/share-an-adventure/${s}`);
    case 'caa-space':
      return PUBLIC_VENUE_SLUGS.map((s) => `/our-venue/${s}`);
    case 'rsvp-step':
      return RSVP_STEP_PATHS;
    case 'photo-collection':
      return DEFAULT_COLLECTIONS.map((c) => `/photos/${c.slug}`);
    case 'admin-content-table':
      return CONTENT_TABLE_PATHS;
    case 'admin-content-new':
      return CONTENT_TABLE_NAMES.map((t) => `/admin/content/${t}/new`);
    case 'admin-content-row':
      return [CRAWL_EXAMPLES.contentRow];
    case 'invitation':
      return [CRAWL_EXAMPLES.invitation];
    case 'invite':
      return [CRAWL_EXAMPLES.invite];
    default:
      return [p.example ?? p.path];
  }
}

function crawlExampleFor(p: SitemapPage, examples: readonly string[]): string | null {
  switch (p.id) {
    case 'adventure':
      return CRAWL_EXAMPLES.adventure;
    case 'share-item':
      return CRAWL_EXAMPLES.recommendation;
    case 'caa-space':
      return CRAWL_EXAMPLES.venue;
    case 'rsvp-step':
      return CRAWL_EXAMPLES.rsvpStep;
    case 'photo-collection':
      return CRAWL_EXAMPLES.photo;
    case 'admin-content-table':
      return CRAWL_EXAMPLES.contentTable;
    case 'admin-content-new':
      return CRAWL_EXAMPLES.contentNew;
    case 'admin-content-row':
      return CRAWL_EXAMPLES.contentRow;
    case 'invitation':
      return CRAWL_EXAMPLES.invitation;
    case 'invite':
      return CRAWL_EXAMPLES.invite;
    default:
      return examples[0] ?? null;
  }
}

function pageRows(): InventoryRow[] {
  return PAGES.map((p) => {
    const examples = examplesFor(p);
    const crawlExample = crawlExampleFor(p, examples);
    return {
      url: p.path,
      examples,
      crawlExample,
      audience: p.audience,
      method: 'GET',
      purpose: p.job,
      expected: pageExpected(p),
      kind: 'page' as const,
      crawl: crawlExample !== null,
      probe: null,
    };
  });
}

function internalRows(): InventoryRow[] {
  return [
    {
      url: INTERNAL_ROUTES[0],
      examples: THEME_IDS.map((t) => `/t/${t}`),
      crawlExample: CRAWL_EXAMPLES.theme,
      audience: 'public',
      method: 'GET',
      purpose: 'The statically rendered theme tree the proxy rewrites a clean public URL onto. Not a page in the guest’s sense.',
      expected: '200 for a known theme. An unknown theme is 404. Visitors normally arrive via the clean URL (/), which the proxy rewrites here.',
      kind: 'internal',
      crawl: true,
      probe: null,
    },
    {
      url: INTERNAL_ROUTES[1],
      examples: [CRAWL_EXAMPLES.preview],
      crawlExample: CRAWL_EXAMPLES.preview,
      audience: 'public',
      method: 'GET',
      purpose: 'Home with an admin lifecycle preview token. The proxy rewrites /?preview=… here.',
      expected: '200 for any visitor. The preview changes what an administrator sees; everyone else sees the published lifecycle.',
      kind: 'internal',
      crawl: true,
      probe: null,
    },
  ];
}

function redirectRows(): InventoryRow[] {
  return REDIRECTS.map((r) => ({
    url: r.source,
    examples: [r.source.replace(':slug', 'white-city-ballroom')],
    crawlExample: r.source.includes(':') ? null : r.source,
    audience: 'public' as const,
    method: 'GET',
    purpose: `Permanent alias of ${r.destination}.`,
    expected: `308 to ${r.destination}. The fragment is kept by the browser.`,
    kind: 'redirect' as const,
    crawl: !r.source.includes(':'),
    probe: null,
  }));
}

function apiRows(): InventoryRow[] {
  // API, export and probe rows are not HTML visits. Callers omit `crawl`; the default is false
  // so a status check never becomes a browser open (sitemap.xml is probed, not rendered).
  const row = (
    partial: Omit<InventoryRow, 'kind' | 'probe' | 'crawlExample' | 'crawl'> & {
      kind?: InventoryKind;
      probe?: number | null;
      crawlExample?: string | null;
      crawl?: boolean;
    },
  ): InventoryRow => ({
    ...partial,
    kind: partial.kind ?? 'api',
    probe: partial.probe ?? null,
    crawlExample: partial.crawlExample ?? null,
    crawl: partial.crawl ?? false,
  });
  return [
    row({
      url: '/api/health',
      examples: ['/api/health'],
      audience: 'api',
      method: 'GET',
      purpose: 'Liveness. Public body is ok, db and time. Inventory (driver, providers, lifecycle) is for an admin or the HEALTH_TOKEN bearer.',
      expected: '200 when the database is up, 503 when it is not. No guest data.',
      probe: 200,
    }),
    row({
      url: '/api/session',
      examples: ['/api/session'],
      audience: 'api',
      method: 'GET',
      purpose: 'Whether this browser is signed in, for the account menu. Not a gate.',
      expected: '200. Anonymous: signedIn false. A view-role preview names the role and nothing about a real guest.',
      probe: 200,
    }),
    row({
      url: '/api/capabilities/[name]',
      examples: ['/api/capabilities/admin_list_view_roles'],
      audience: 'api',
      method: 'GET',
      purpose: 'The capability door does not answer GET.',
      expected: '405 Allow: POST. POST runs one capability. The crawler never POSTs except admin_set_view_role on the test server, to mint a preview.',
    }),
    row({
      url: '/api/capabilities/[name]',
      examples: ['/api/capabilities/admin_list_view_roles'],
      audience: 'api',
      method: 'POST',
      purpose: 'The only HTTP door into the capability pipeline (CSRF, rate limit, audit).',
      expected: '200 with { ok: true } when the principal may run it. 401 signed out, 403 without the entitlement, 405 is not used for POST.',
    }),
    row({
      url: '/api/ai/chat',
      examples: ['/api/ai/chat'],
      audience: 'api',
      method: 'GET',
      purpose: 'The concierge stream is POST only.',
      expected: '405 Allow: POST.',
    }),
    row({
      url: '/api/ai/chat',
      examples: ['/api/ai/chat'],
      audience: 'api',
      method: 'POST',
      purpose: 'Ask the concierge. Answers are grounded in published pages. No hosted model is called.',
      expected: '200 NDJSON when the body is JSON from this origin. 403 on a form-encoded or cross-origin POST.',
    }),
    row({
      url: '/api/auth/[...all]',
      examples: ['/api/auth/get-session'],
      audience: 'api',
      method: 'GET',
      purpose: 'Better Auth session read and passkey ceremony. OTP and claim are capabilities, not this route.',
      expected: 'Better Auth’s own status. A cross-origin mutation is 403 before the library runs.',
    }),
    row({
      url: '/api/auth/[...all]',
      examples: ['/api/auth/sign-out'],
      audience: 'api',
      method: 'POST',
      purpose: 'Better Auth mutations (sign-out, passkey). Same-origin only.',
      expected: '403 when Origin is not this site. Otherwise Better Auth’s response. The crawler does not call it.',
    }),
    row({
      url: '/api/webmcp/manifest',
      examples: ['/api/webmcp/manifest'],
      audience: 'api',
      method: 'GET',
      purpose: 'WebMCP tools the current principal may see.',
      expected: '200 JSON manifest. POST is 405.',
    }),
    row({
      url: '/api/webmcp/manifest',
      examples: ['/api/webmcp/manifest'],
      audience: 'api',
      method: 'POST',
      purpose: 'Manifest is read-only.',
      expected: '405 Allow: GET.',
    }),
    row({
      url: '/api/webmcp/invoke/[name]',
      examples: ['/api/webmcp/invoke/example'],
      audience: 'api',
      method: 'GET',
      purpose: 'WebMCP invoke is POST only.',
      expected: '405 Allow: POST.',
    }),
    row({
      url: '/api/webmcp/invoke/[name]',
      examples: ['/api/webmcp/invoke/example'],
      audience: 'api',
      method: 'POST',
      purpose: 'Run one WebMCP tool as the current principal.',
      expected: 'The tool’s own status. Unknown name is refused. The crawler does not call it.',
    }),
    row({
      url: '/api/uploads/[action]',
      examples: ['/api/uploads/create'],
      audience: 'api',
      method: 'GET',
      purpose: 'Upload aliases of media capabilities. GET is refused.',
      expected: '405 Allow: POST. POST create, resume, complete or abort. Any other action is 404.',
    }),
    row({
      url: '/api/uploads/[action]',
      examples: ['/api/uploads/create'],
      audience: 'api',
      method: 'POST',
      purpose: 'Start, resume, finish or abort an upload through the capability pipeline.',
      expected: 'Same rules as /api/capabilities. The crawler does not upload.',
    }),
    row({
      url: '/api/jobs/run',
      examples: ['/api/jobs/run'],
      audience: 'api',
      method: 'GET',
      purpose: 'Cron: run a bounded batch of due jobs. GET and POST are the same handler.',
      expected: '401 without the CRON_SECRET bearer. The handler does not run jobs when it refuses. The crawler does not call it.',
    }),
    row({
      url: '/api/jobs/run',
      examples: ['/api/jobs/run'],
      audience: 'api',
      method: 'POST',
      purpose: 'Cron: same handler as GET.',
      expected: '401 without the CRON_SECRET bearer. With the bearer, runs due jobs. Never called by the crawler.',
    }),
    row({
      url: '/api/media-ai/jobs/run',
      examples: ['/api/media-ai/jobs/run'],
      audience: 'api',
      method: 'GET',
      purpose: 'Cron alias that keeps the media index scan queued and runs a bounded batch.',
      expected: '401 without the CRON_SECRET bearer. Does not run when it refuses.',
    }),
    row({
      url: '/api/media-ai/jobs/run',
      examples: ['/api/media-ai/jobs/run'],
      audience: 'api',
      method: 'POST',
      purpose: 'Cron alias, same handler as GET.',
      expected: '401 without the CRON_SECRET bearer. Never called by the crawler.',
    }),
    row({
      url: '/api/uploads/jobs/run',
      examples: ['/api/uploads/jobs/run'],
      audience: 'api',
      method: 'GET',
      purpose: 'Cron alias that keeps a media sweep queued and runs a bounded batch.',
      expected: '401 without the CRON_SECRET bearer. Does not run when it refuses.',
    }),
    row({
      url: '/api/uploads/jobs/run',
      examples: ['/api/uploads/jobs/run'],
      audience: 'api',
      method: 'POST',
      purpose: 'Cron alias, same handler as GET.',
      expected: '401 without the CRON_SECRET bearer. Never called by the crawler.',
    }),
    row({
      url: '/api/webhooks/resend',
      examples: ['/api/webhooks/resend'],
      audience: 'api',
      method: 'GET',
      purpose: 'Resend inbound mail is POST only.',
      expected: '405 Allow: POST.',
    }),
    row({
      url: '/api/webhooks/resend',
      examples: ['/api/webhooks/resend'],
      audience: 'api',
      method: 'POST',
      purpose: 'Signed Resend inbound events. Forwards mail for the wedding address to the planner.',
      expected: '401 or 400 without a valid Svix signature. The crawler does not post a body.',
    }),
    row({
      url: '/travel/webhooks/duffel',
      examples: ['/travel/webhooks/duffel'],
      audience: 'api',
      method: 'GET',
      purpose: 'Duffel booking events are POST only.',
      expected: '405 Allow: POST.',
    }),
    row({
      url: '/travel/webhooks/duffel',
      examples: ['/travel/webhooks/duffel'],
      audience: 'api',
      method: 'POST',
      purpose: 'Signed Duffel booking webhook. Not a guest page.',
      expected: '404 when no webhook is configured, 401 when the signature is missing. The crawler does not post a body.',
    }),
    row({
      url: '/api/dev/inbox',
      examples: ['/api/dev/inbox'],
      audience: 'api',
      method: 'GET',
      purpose: 'Development inbox of OTP mail captured by the mock mailer.',
      expected: '404 when the dev gate is closed (production, and CI without the bearer). Otherwise 200 and the captured messages. The crawler does not call DELETE, which clears the inbox.',
    }),
    row({
      url: '/api/dev/inbox',
      examples: ['/api/dev/inbox'],
      audience: 'api',
      method: 'DELETE',
      purpose: 'Clears the development inbox.',
      expected: '404 when the dev gate is closed. Otherwise 200 and the inbox is empty. Never called by the crawler.',
    }),
    row({
      url: '/api/dev/identity',
      examples: ['/api/dev/identity'],
      audience: 'api',
      method: 'POST',
      purpose: 'Development only: seeds a fresh fixture identity set and returns its tokens.',
      expected: '404 when the dev gate is closed. Otherwise 200 with fixture ids. Creates rows. Never called by the crawler.',
    }),
    row({
      url: '/api/dev/storage/[...key]',
      examples: ['/api/dev/storage/example'],
      audience: 'api',
      method: 'GET',
      purpose: 'Local-fs stand-in for signed upload bytes. Not production storage.',
      expected: '404 in production. Outside production, a signed query reads an object; an unsigned request is refused.',
    }),
    row({
      url: '/api/dev/storage/[...key]',
      examples: ['/api/dev/storage/example'],
      audience: 'api',
      method: 'HEAD',
      purpose: 'Local-fs object metadata.',
      expected: '404 in production. Same signature rule as GET.',
    }),
    row({
      url: '/api/dev/storage/[...key]',
      examples: ['/api/dev/storage/example'],
      audience: 'api',
      method: 'PUT',
      purpose: 'Local-fs write of one upload part.',
      expected: '404 in production. A signed PUT writes bytes. Never called by the crawler.',
    }),
    row({
      url: '/admin/guests/export',
      examples: ['/admin/guests/export'],
      audience: 'admin',
      method: 'GET',
      purpose: 'CSV of guests for an administrator with guest ops.',
      expected: '401 signed out. 200 text/csv for an administrator who may export. Read-only.',
      kind: 'export',
    }),
    row({
      url: '/admin/rsvp/export',
      examples: ['/admin/rsvp/export'],
      audience: 'admin',
      method: 'GET',
      purpose: 'CSV of RSVPs for an administrator with guest ops.',
      expected: '401 signed out. 200 text/csv for an administrator who may export. Read-only.',
      kind: 'export',
    }),
    row({
      url: CRAWL_EXAMPLES.sitemapXml,
      examples: [CRAWL_EXAMPLES.sitemapXml],
      audience: 'public',
      method: 'GET',
      purpose: 'Public URL list for search engines. Audience public only; see the note in docs/sitemap.md.',
      expected: '200 application/xml. No admin, guest or gate path.',
      kind: 'page',
      probe: 200,
    }),
  ];
}

let cached: InventoryRow[] | null = null;

/** Every endpoint, in the order the admin page and the doc render. */
export function inventory(): InventoryRow[] {
  if (!cached) cached = [...pageRows(), ...internalRows(), ...redirectRows(), ...apiRows()];
  return cached;
}

/**
 * HTML routes one persona opens. Redirects and the theme tree are visited once, signed out:
 * they do not change with the principal. View-role preview does not apply on admin surfaces,
 * so those routes are the administrator persona’s.
 */
export function routesForPersona(kind: CrawlPersonaKind): InventoryRow[] {
  return inventory().filter((row) => {
    if (!row.crawl || !row.crawlExample) return false;
    if (row.kind === 'redirect' || row.kind === 'internal') return kind === 'anonymous';
    if (row.audience === 'public' || row.audience === 'gate') return true;
    if (row.audience === 'guest') return kind === 'guest' || kind === 'admin' || kind === 'view-role';
    if (row.audience === 'admin') return kind === 'admin';
    return false;
  });
}

/** Paths listed in /sitemap.xml. Public audience only, real seed slugs, no lifecycle filter. */
export function publicSitemapPaths(): string[] {
  const paths = new Set<string>();
  for (const row of inventory()) {
    if (row.audience !== 'public' || row.kind === 'redirect' || row.kind === 'internal' || row.kind === 'api') continue;
    if (row.url === CRAWL_EXAMPLES.sitemapXml) continue;
    const page = PAGES.find((p) => p.path === row.url);
    if (page?.audience === 'public') {
      if (page.path.includes('[')) {
        for (const example of row.examples) paths.add(example);
      } else {
        paths.add(page.path);
      }
    }
  }
  return [...paths].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * Human sitemap. `docs/sitemap.md` is this string; `tests/unit/site-inventory.test.ts` fails when
 * the file drifts. Regenerate with `node --import tsx scripts/render-sitemap-md.ts`.
 */
export function inventoryMarkdown(): string {
  const rows = inventory();
  const header = [
    '# Site map',
    '',
    'Every endpoint the wedding app serves. Generated from `src/lib/site-inventory.ts`.',
    'Do not edit this file by hand. Regenerate it with `node --import tsx scripts/render-sitemap-md.ts`.',
    'The admin page at `/admin/sitemap` renders the same rows.',
    '',
    'Audiences match the pipeline sitemap (`stages/01-sitemap/lib/sitemap.ts`): public, guest, gate, admin. API routes are `api`.',
    '',
    '`/sitemap.xml` lists **public** pages only. Lifecycle `visibleFrom` is not applied: it controls navigation, not whether the route exists. Dynamic public routes use seed rows whose visibility is `public`. The placeholder `/example` is not listed. Admin, guest, gate, internal theme URLs, APIs and redirects are omitted. The site-wide `noindex` in the root layout is a pre-launch setting; this file is the public URL list for when that changes.',
    '',
    'Invitation tokens are named only as `/i/example` and `/invite/example`. No real guest token appears here.',
    '',
    'A dynamic route’s Example column is the path the crawler opens. Further seed paths are listed under the table.',
    '',
  ];

  const table = (title: string, list: InventoryRow[]) => {
    const lines = [
      `## ${title}`,
      '',
      '| URL | Example | Audience | Method | Purpose | Expected |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const row of list) {
      const example = row.crawlExample ?? row.examples[0] ?? '';
      lines.push(`| ${cell(row.url)} | ${cell(example)} | ${row.audience} | ${row.method} | ${cell(row.purpose)} | ${cell(row.expected)} |`);
    }
    lines.push('');
    return lines;
  };

  const extra: string[] = ['## Concrete seed and fixture paths', ''];
  for (const row of rows) {
    const more = row.examples.filter((e) => e !== (row.crawlExample ?? row.examples[0]));
    if (more.length === 0 && !(row.url.includes('[') && row.examples.length > 0)) continue;
    if (row.examples.length <= 1) continue;
    extra.push(`### ${row.method} ${row.url}`, '');
    extra.push(`${row.audience}. ${row.purpose}`, '');
    for (const example of row.examples) extra.push(`- \`${example}\``);
    extra.push('');
  }

  return [...header, ...table('Pages', rows.filter((r) => r.kind === 'page' && r.url !== CRAWL_EXAMPLES.sitemapXml)), ...table('Internal routes', rows.filter((r) => r.kind === 'internal')), ...table('Redirects', rows.filter((r) => r.kind === 'redirect')), ...table('API and export routes', rows.filter((r) => r.kind === 'api' || r.kind === 'export' || r.url === CRAWL_EXAMPLES.sitemapXml)), ...extra].join('\n');
}

/** The URL a crawler requests for a row. */
export function crawlUrl(row: InventoryRow): string {
  return row.crawlExample ?? href({ path: row.url, example: row.examples[0] } as SitemapPage);
}
