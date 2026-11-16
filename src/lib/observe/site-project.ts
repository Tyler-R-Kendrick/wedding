/**
 * This site's own PostHog project, and when a build uses it without being told to.
 *
 * A PostHog project token is public: it is in every page of every site that uses PostHog, and it
 * can only add events. So it can live here, where the two environment variables otherwise had to
 * be typed into the hosting settings by hand before tracing did anything at all.
 *
 * The default applies to one thing only: the production deployment of this repository. A preview,
 * a local checkout, a test run and anybody's fork send nothing unless the variables are set, so
 * none of them can write into the couple's project by accident. Setting the variables always wins,
 * and setting the token to anything that is not a token (`off`) switches tracing off.
 */
export const SITE_POSTHOG = {
  /** Organisation `wedding`, project `Wedding` (US cloud). */
  token: 'phc_yHVLg53tGj6m6nzt8j3pk2Nw2j7aUUiBsRbG9xcYZ9vN',
  host: 'https://us.i.posthog.com',
} as const;

const SITE_REPO = { owner: 'tyler-r-kendrick', slug: 'wedding' } as const;
const SITE_DOMAIN = 'kendrick.wedding';

type BuildEnv = Record<string, string | undefined>;

/** Is this build the production deployment of this site, by what the platform says about it? */
export function isSiteProduction(env: BuildEnv): boolean {
  if (env.VERCEL_ENV !== 'production') return false;
  const repo = env.VERCEL_GIT_REPO_OWNER?.toLowerCase() === SITE_REPO.owner && env.VERCEL_GIT_REPO_SLUG?.toLowerCase() === SITE_REPO.slug;
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
  return repo || host === SITE_DOMAIN || host.endsWith(`.${SITE_DOMAIN}`);
}

/** What `next.config.ts` inlines for the two public variables, or null to leave them as they are. */
export function deployedPostHog(env: BuildEnv): { token: string; host: string } | null {
  const token = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (token) return null; // Set by hand (or switched off by hand): nothing to add.
  return isSiteProduction(env) ? { ...SITE_POSTHOG } : null;
}
