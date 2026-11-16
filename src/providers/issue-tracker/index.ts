import { GITHUB_REPO_SHAPE, GitHubIssueTracker } from './github';
import type { FetchLike } from './http';
import { LinearIssueTracker } from './linear';
import { MockIssueTracker, UnconfiguredIssueTracker } from './mock';
import type { IssueTrackerProvider } from './types';

export * from './types';
export { MockIssueTracker, UnconfiguredIssueTracker } from './mock';
export { LinearIssueTracker, LINEAR_API_URL } from './linear';
export { GitHubIssueTracker, GITHUB_API_URL } from './github';

/**
 * The few settings the tracker reads, as plain strings.
 *
 * Not `ServerEnv`: the report endpoint builds a tracker straight from `process.env` when the
 * validated environment will not load (src/lib/feedback/deliver.ts), because a report about a
 * broken deployment must not need the deployment to be healthy.
 */
export interface IssueTrackerEnv {
  NODE_ENV?: string | undefined;
  FORCE_MOCK_PROVIDERS?: boolean | string | undefined;
  ISSUE_TRACKER?: string | undefined;
  LINEAR_API_KEY?: string | undefined;
  LINEAR_TEAM?: string | undefined;
  LINEAR_PROJECT_ID?: string | undefined;
  GITHUB_ISSUES_TOKEN?: string | undefined;
  GITHUB_ISSUES_REPO?: string | undefined;
  GITHUB_ISSUES_LABELS?: string | undefined;
  GITHUB_ISSUES_ALLOW_PUBLIC?: boolean | string | undefined;
}

const on = (v: boolean | string | undefined): boolean => v === true || (typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim()));
const text = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

/**
 * Linear when its two settings are present, else GitHub when its two are, else the in-memory mock
 * (development, tests) or an honest "unconfigured" (production). `ISSUE_TRACKER` picks one by name
 * when both are configured. Linear wins a tie: it is private, takes a screenshot, and has a Triage
 * inbox built for exactly this.
 */
export function createIssueTrackerProvider(env: IssueTrackerEnv, deps: { fetchImpl?: FetchLike } = {}): IssueTrackerProvider {
  const production = env.NODE_ENV === 'production';
  const none = (missing?: string[]): IssueTrackerProvider => (production ? new UnconfiguredIssueTracker(missing) : new MockIssueTracker());
  if (on(env.FORCE_MOCK_PROVIDERS) || env.NODE_ENV === 'test') return new MockIssueTracker();

  const choice = text(env.ISSUE_TRACKER)?.toLowerCase();
  if (choice === 'mock' || choice === 'off') return none();

  const linearKey = text(env.LINEAR_API_KEY);
  const linearTeam = text(env.LINEAR_TEAM);
  const githubToken = text(env.GITHUB_ISSUES_TOKEN);
  const githubRepo = text(env.GITHUB_ISSUES_REPO);
  const linear = () => new LinearIssueTracker({ apiKey: linearKey!, team: linearTeam!, ...(text(env.LINEAR_PROJECT_ID) ? { projectId: text(env.LINEAR_PROJECT_ID)! } : {}) }, deps.fetchImpl);
  const github = () =>
    new GitHubIssueTracker(
      {
        token: githubToken!,
        repo: githubRepo!,
        labels: (text(env.GITHUB_ISSUES_LABELS) ?? 'site-feedback').split(',').map((l) => l.trim()).filter(Boolean).slice(0, 5),
        allowPublic: on(env.GITHUB_ISSUES_ALLOW_PUBLIC),
      },
      deps.fetchImpl,
    );
  const linearReady = !!(linearKey && linearTeam);
  const githubReady = !!(githubToken && githubRepo && GITHUB_REPO_SHAPE.test(githubRepo));

  if (choice === 'linear') return linearReady ? linear() : none([!linearKey ? 'LINEAR_API_KEY' : '', !linearTeam ? 'LINEAR_TEAM' : ''].filter(Boolean));
  if (choice === 'github') return githubReady ? github() : none([!githubToken ? 'GITHUB_ISSUES_TOKEN' : '', !githubRepo || !GITHUB_REPO_SHAPE.test(githubRepo) ? 'GITHUB_ISSUES_REPO' : ''].filter(Boolean));
  if (linearReady) return linear();
  if (githubReady) return github();
  return none();
}
