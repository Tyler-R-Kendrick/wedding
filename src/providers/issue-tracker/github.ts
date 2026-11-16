import { err, ok, type Result } from '@/contracts/result';
import type { ProviderFailure } from '@/contracts/providers';
import { failure, okConfig } from '../base';
import { classifyStatus, classifyThrown, TRACKER_TIMEOUT_MS, type FetchLike } from './http';
import type { CreatedIssue, IssueTrackerProvider, NewIssue } from './types';

export const GITHUB_API_URL = 'https://api.github.com';
/** `owner/name`, as GitHub spells both: letters, digits, `-`, `_`, `.`. */
export const GITHUB_REPO_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export interface GitHubConfig {
  token: string;
  /** `owner/name`. */
  repo: string;
  labels: string[];
  /**
   * File reports in a repository anyone can read. Off unless set: a report carries the page it was
   * made on and whatever the couple typed, and PRODUCT.md keeps guest names out of public view.
   */
  allowPublic: boolean;
}

/**
 * GitHub Issues, through the REST API with a fine-grained token (Issues: read and write).
 *
 * Two things GitHub cannot do, both said where they bite rather than papered over:
 *  - It has no API for attaching a picture to an issue, so a screenshot is not stored and the issue
 *    says one was sent. Linear takes screenshots; that is the reason to prefer it.
 *  - Issues in a public repository are public. The adapter looks the repository up once and refuses
 *    a public one unless `GITHUB_ISSUES_ALLOW_PUBLIC` says the couple chose that.
 */
export class GitHubIssueTracker implements IssueTrackerProvider {
  readonly kind = 'issue-tracker' as const;
  readonly name = 'github';
  readonly mode = 'live' as const;
  readonly capabilities = { createIssue: true, attachments: false };
  private visibility: 'private' | 'public' | undefined;

  constructor(private readonly config: GitHubConfig, private readonly fetchImpl: FetchLike = fetch) {}

  validateConfig() {
    return okConfig(this.config.allowPublic ? ['GITHUB_ISSUES_ALLOW_PUBLIC is set: reports may be filed where anyone can read them'] : []);
  }

  async health() {
    const started = Date.now();
    const allowed = await this.assertAllowed();
    const checkedAt = new Date().toISOString();
    if (!allowed.ok) return { status: 'down' as const, checkedAt, detail: `${allowed.error.class}: ${allowed.error.message}` };
    return { status: 'up' as const, checkedAt, latencyMs: Date.now() - started, detail: `${this.visibility} repository` };
  }

  async createIssue(issue: NewIssue): Promise<Result<CreatedIssue, ProviderFailure>> {
    const allowed = await this.assertAllowed();
    if (!allowed.ok) return allowed;
    const sent = issue.attachments?.length ?? 0;
    const body = sent > 0 ? `${issue.body}\n\n_A screenshot was sent with this report. GitHub has no way to store one through its API, so it is not here._` : issue.body;
    const labels = [...this.config.labels, ...(issue.labels ?? [])];
    let created = await this.call<{ number: number; html_url: string }>('POST', `/repos/${this.config.repo}/issues`, { title: issue.title, body, ...(labels.length ? { labels } : {}) });
    // A label the token may not create is not worth losing the report over.
    if (!created.ok && created.error.class === 'bad_request' && labels.length) {
      created = await this.call<{ number: number; html_url: string }>('POST', `/repos/${this.config.repo}/issues`, { title: issue.title, body });
    }
    if (!created.ok) return created;
    if (typeof created.value.number !== 'number' || typeof created.value.html_url !== 'string') return err(failure(this.name, 'malformed_response', 'GitHub did not create the issue.'));
    return ok({ key: `#${created.value.number}`, url: created.value.html_url, attachmentsStored: 0 });
  }

  private async assertAllowed(): Promise<Result<void, ProviderFailure>> {
    if (!this.visibility) {
      const repo = await this.call<{ private?: boolean }>('GET', `/repos/${this.config.repo}`);
      if (!repo.ok) return repo;
      // Anything but an explicit `private: true` is treated as public.
      this.visibility = repo.value.private === true ? 'private' : 'public';
    }
    if (this.visibility === 'public' && !this.config.allowPublic) {
      return err(failure(this.name, 'unconfigured', `${this.config.repo} is a public repository, and reports are not filed where anyone can read them. Point GITHUB_ISSUES_REPO at a private repository, or use Linear.`));
    }
    return ok(undefined);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result<T, ProviderFailure>> {
    try {
      const res = await this.fetchImpl(`${GITHUB_API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'wedding-site-feedback',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS),
      });
      if (!res.ok) {
        const retryAfter = Number(res.headers.get('retry-after'));
        return err(failure(this.name, classifyStatus(res.status), `GitHub answered ${res.status}.`, Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}));
      }
      return ok((await res.json()) as T);
    } catch (e) {
      return err(failure(this.name, classifyThrown(e), 'GitHub could not be reached.', { raw: e }));
    }
  }
}
