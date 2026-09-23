/**
 * Stage 1 — the sitemap. The shape every later stage reads.
 *
 * A page here is a promise: stage 2 draws it, stage 3 makes it clickable, stage 4 dresses it, and
 * the real app (stage 5) must serve it. Add, rename or move a page in `sitemap.ts` and every stage
 * downstream picks it up on its next build; the real app's route test fails until it serves it.
 */

/** Lifecycle states, in order (mirrors `src/contracts/lifecycle.ts`; a root test keeps them equal). */
export const LIFECYCLE_STATES = [
  'TEASER',
  'SAVE_THE_DATE',
  'INVITATIONS_OPEN',
  'RSVP_OPEN',
  'RSVP_CLOSED',
  'WEDDING_WEEK',
  'WEDDING_DAY',
  'POST_WEDDING',
  'ARCHIVE',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Who a page is for.
 * - `public`: anyone with the link.
 * - `guest`: an invited guest who has claimed their invitation.
 * - `gate`: the doors between the two (invitation links, sign-in, claim).
 * - `admin`: Sara, Tyler and the planner.
 */
export type Audience = 'public' | 'guest' | 'gate' | 'admin';

/** The visitor's mode on the page (PRODUCT.md "Visitor mode"). */
export type VisitorMode = 'inform' | 'act' | 'celebrate' | 'gate' | 'admin';

/** Ids are stable handles later stages key off. Paths may change; ids should not. */
export type PageId = string;

export interface PageAction {
  label: string;
  /** Another page's id. Validated: an action may not point at a page the sitemap does not have. */
  to: PageId;
}

export interface SitemapPage {
  id: PageId;
  /** Route pattern as the real app serves it, e.g. `/our-adventures/[slug]`. */
  path: string;
  /** A concrete URL for a patterned path, so every stage can render one instance of it. */
  example?: string;
  title: string;
  /** Label in the site navigation, when it differs from the title. */
  navLabel?: string;
  /** Parent page id; `null` for a top-level page. */
  parent: PageId | null;
  audience: Audience;
  mode: VisitorMode[];
  /** First lifecycle state in which the page is reachable. `null` for admin/internal pages. */
  visibleFrom: LifecycleState | null;
  /** The page's job in one sentence. Stage 2 uses it as the page brief. */
  job: string;
  /** The one thing the page wants the visitor to do next. */
  primaryAction?: PageAction;
  /** Whether the page belongs in the guest-facing navigation. */
  inNav?: boolean;
  /** Notes for the people building later stages. */
  notes?: string[];
}

export interface SitemapSection {
  id: string;
  title: string;
  audience: Audience;
  blurb: string;
}
