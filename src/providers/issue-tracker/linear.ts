import { err, ok, type Result } from '@/contracts/result';
import type { ProviderFailure } from '@/contracts/providers';
import { failure, okConfig } from '../base';
import { classifyStatus, classifyThrown, TRACKER_TIMEOUT_MS, type FetchLike } from './http';
import type { CreatedIssue, IssueAttachment, IssueTrackerProvider, NewIssue } from './types';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LinearConfig {
  apiKey: string;
  /** A team's key (`WED`) or its id. */
  team: string;
  projectId?: string;
}

interface Team {
  id: string;
  /** The team's Triage state, when triage is switched on for it. */
  triageStateId?: string;
}

const TEAM_FIELDS = 'id states(filter: { type: { eq: "triage" } }) { nodes { id } }';

/**
 * Linear, through its GraphQL API with a personal API key.
 *
 * A report is created in the team's Triage state when the team has one, which is where Linear
 * expects unscoped work to arrive: it is accepted, prioritised or declined from there. A team
 * without triage takes it in its default state. A screenshot is uploaded to Linear's own storage
 * and embedded in the description, so the picture is as private as the workspace.
 */
export class LinearIssueTracker implements IssueTrackerProvider {
  readonly kind = 'issue-tracker' as const;
  readonly name = 'linear';
  readonly mode = 'live' as const;
  readonly capabilities = { createIssue: true, attachments: true };
  private team: Team | undefined;

  constructor(private readonly config: LinearConfig, private readonly fetchImpl: FetchLike = fetch) {}

  validateConfig() {
    return okConfig();
  }

  async health() {
    const started = Date.now();
    const team = await this.resolveTeam();
    const checkedAt = new Date().toISOString();
    if (!team.ok) return { status: 'down' as const, checkedAt, detail: `${team.error.class}: ${team.error.message}` };
    return { status: 'up' as const, checkedAt, latencyMs: Date.now() - started, detail: team.value.triageStateId ? 'reports arrive in Triage' : 'team has no Triage state; reports arrive in its default state' };
  }

  async createIssue(issue: NewIssue): Promise<Result<CreatedIssue, ProviderFailure>> {
    const team = await this.resolveTeam();
    if (!team.ok) return team;

    // A picture that will not upload must not cost the report: it is filed without it, and says so.
    let body = issue.body;
    let stored = 0;
    for (const attachment of issue.attachments ?? []) {
      const uploaded = await this.upload(attachment);
      if (uploaded.ok) {
        body += `\n\n![${attachment.filename}](${uploaded.value})`;
        stored += 1;
      } else {
        body += `\n\n_A screenshot was sent with this report but could not be stored (${uploaded.error.class})._`;
      }
    }

    const created = await this.graphql<{ issueCreate: { success: boolean; issue: { identifier: string; url: string } | null } }>(
      'mutation Report($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }',
      {
        input: {
          teamId: team.value.id,
          title: issue.title,
          description: body,
          ...(team.value.triageStateId ? { stateId: team.value.triageStateId } : {}),
          ...(this.config.projectId ? { projectId: this.config.projectId } : {}),
        },
      },
    );
    if (!created.ok) return created;
    const made = created.value.issueCreate;
    if (!made.success || !made.issue) return err(failure(this.name, 'malformed_response', 'Linear did not create the issue.'));
    return ok({ key: made.issue.identifier, url: made.issue.url, attachmentsStored: stored });
  }

  private async resolveTeam(): Promise<Result<Team, ProviderFailure>> {
    if (this.team) return ok(this.team);
    const byId = UUID.test(this.config.team);
    const found = byId
      ? await this.graphql<{ team: { id: string; states: { nodes: { id: string }[] } } | null }>(`query Team($id: String!) { team(id: $id) { ${TEAM_FIELDS} } }`, { id: this.config.team })
      : await this.graphql<{ teams: { nodes: { id: string; states: { nodes: { id: string }[] } }[] } }>(`query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { ${TEAM_FIELDS} } } }`, { key: this.config.team.toUpperCase() });
    if (!found.ok) return found;
    const node = 'team' in found.value ? found.value.team : found.value.teams.nodes[0];
    if (!node) return err(failure(this.name, 'not_found', 'LINEAR_TEAM names no team this API key can see.'));
    const triage = node.states.nodes[0]?.id;
    this.team = { id: node.id, ...(triage ? { triageStateId: triage } : {}) };
    return ok(this.team);
  }

  /** Linear's two-step upload: ask for a signed URL, PUT the bytes with the headers it names. */
  private async upload(attachment: IssueAttachment): Promise<Result<string, ProviderFailure>> {
    const asked = await this.graphql<{ fileUpload: { success: boolean; uploadFile: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] } | null } }>(
      'mutation Upload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
      { contentType: attachment.contentType, filename: attachment.filename, size: attachment.bytes.byteLength },
    );
    if (!asked.ok) return asked;
    const target = asked.value.fileUpload.uploadFile;
    if (!asked.value.fileUpload.success || !target) return err(failure(this.name, 'malformed_response', 'Linear did not offer an upload address.'));
    try {
      const headers = new Headers({ 'Content-Type': attachment.contentType, 'Cache-Control': 'public, max-age=31536000' });
      for (const h of target.headers) headers.set(h.key, h.value);
      const put = await this.fetchImpl(target.uploadUrl, { method: 'PUT', headers, body: attachment.bytes as BodyInit, signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS) });
      if (!put.ok) return err(failure(this.name, classifyStatus(put.status), 'Linear refused the screenshot.'));
      return ok(target.assetUrl);
    } catch (e) {
      return err(failure(this.name, classifyThrown(e), 'The screenshot did not reach Linear.', { raw: e }));
    }
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<Result<T, ProviderFailure>> {
    try {
      const res = await this.fetchImpl(LINEAR_API_URL, {
        method: 'POST',
        // A personal API key goes in the header as it is; `Bearer` is for OAuth tokens only.
        headers: { Authorization: this.config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS),
      });
      if (!res.ok) return err(failure(this.name, classifyStatus(res.status), `Linear answered ${res.status}.`));
      const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
      if (body.errors?.length || !body.data) {
        // GraphQL reports its own failures inside a 200. The message names fields, never the key.
        return err(failure(this.name, 'bad_request', `Linear rejected the request: ${(body.errors?.[0]?.message ?? 'no data').slice(0, 200)}`, { raw: body.errors }));
      }
      return ok(body.data);
    } catch (e) {
      return err(failure(this.name, classifyThrown(e), 'Linear could not be reached.', { raw: e }));
    }
  }
}
