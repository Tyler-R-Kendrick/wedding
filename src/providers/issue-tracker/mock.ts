import { err, ok } from '@/contracts/result';
import { failure, okConfig, unconfiguredHealth, upHealth } from '../base';
import type { CreatedIssue, IssueTrackerProvider, NewIssue } from './types';

/** Development and tests: issues are kept in memory, newest last, and nothing leaves the machine. */
export class MockIssueTracker implements IssueTrackerProvider {
  readonly kind = 'issue-tracker' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { createIssue: true, attachments: true };
  readonly issues: (NewIssue & CreatedIssue)[] = [];
  /** Tests: make the next `n` calls fail the way an outage would. */
  failNext = 0;

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth('in-memory');
  }
  async createIssue(issue: NewIssue) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return err(failure(this.name, 'server', 'The issue tracker did not answer.'));
    }
    const created: CreatedIssue = { key: `MOCK-${this.issues.length + 1}`, url: `https://tracker.invalid/MOCK-${this.issues.length + 1}`, attachmentsStored: issue.attachments?.length ?? 0 };
    this.issues.push({ ...issue, ...created });
    return ok(created);
  }
}

/**
 * Production with no tracker configured. Every call fails as `unconfigured`, so a report takes the
 * next rung (email to the couple, then the log) instead of landing in memory nobody can read.
 */
export class UnconfiguredIssueTracker implements IssueTrackerProvider {
  readonly kind = 'issue-tracker' as const;
  readonly name = 'unconfigured';
  readonly mode = 'unavailable' as const;
  readonly capabilities = { createIssue: false, attachments: false };
  constructor(private readonly missing: string[] = ['LINEAR_API_KEY, or GITHUB_ISSUES_TOKEN + GITHUB_ISSUES_REPO']) {}

  validateConfig() {
    return { ok: false, missing: this.missing, warnings: [] };
  }
  async health() {
    return unconfiguredHealth('no issue tracker is configured');
  }
  async createIssue() {
    return err(failure(this.name, 'unconfigured', 'No issue tracker is configured.'));
  }
}
