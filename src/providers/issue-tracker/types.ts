import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

/** One picture sent with a report. Bytes, never a URL: the tracker stores its own copy. */
export interface IssueAttachment {
  filename: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

export interface NewIssue {
  title: string;
  /** Markdown. Already scrubbed and length-capped by the caller (src/lib/feedback/report.ts). */
  body: string;
  labels?: string[];
  attachments?: IssueAttachment[];
}

export interface CreatedIssue {
  /** The tracker's own reference: `WED-12`, `#131`. */
  key: string;
  url: string;
  /** Attachments the tracker took. Fewer than were sent when it has nowhere to put a file. */
  attachmentsStored: number;
}

/**
 * Where a problem report from the couple becomes work to be done: a Linear issue or a GitHub issue.
 * The site only ever creates; triage, priority and closing happen in the tracker.
 */
export interface IssueTrackerProvider extends ProviderDescriptor {
  kind: 'issue-tracker';
  createIssue(issue: NewIssue): Promise<Result<CreatedIssue, ProviderFailure>>;
}
