import { describe, expect, it } from 'vitest';
import { createIssueTrackerProvider, GitHubIssueTracker, LinearIssueTracker, MockIssueTracker, UnconfiguredIssueTracker } from '@/providers/issue-tracker';

type Call = { url: string; method: string; headers: Record<string, string>; body: string | Uint8Array | undefined };

/** A fetch that answers from a script, and remembers what it was asked. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    const call: Call = { url: String(input), method: init.method ?? 'GET', headers, body: init.body as string | Uint8Array | undefined };
    calls.push(call);
    return answer(call);
  };
  return { fetchImpl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

describe('choosing a tracker', () => {
  const linear = { LINEAR_API_KEY: 'lin_api_0123456789abcdef', LINEAR_TEAM: 'WED' };
  const github = { GITHUB_ISSUES_TOKEN: 'github_pat_0123456789abcdef', GITHUB_ISSUES_REPO: 'couple/wedding-feedback' };

  it('is the in-memory mock in development and in tests, whatever is configured', () => {
    expect(createIssueTrackerProvider({ NODE_ENV: 'development' })).toBeInstanceOf(MockIssueTracker);
    expect(createIssueTrackerProvider({ NODE_ENV: 'test', ...linear })).toBeInstanceOf(MockIssueTracker);
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', FORCE_MOCK_PROVIDERS: true, ...linear })).toBeInstanceOf(MockIssueTracker);
  });

  it('is honestly unconfigured in production with nothing set, never a mock nobody can read', () => {
    const tracker = createIssueTrackerProvider({ NODE_ENV: 'production' });
    expect(tracker).toBeInstanceOf(UnconfiguredIssueTracker);
    expect(tracker.mode).toBe('unavailable');
    expect(tracker.capabilities.createIssue).toBe(false);
    expect(tracker.validateConfig().ok).toBe(false);
  });

  it('prefers Linear when both are configured, and takes ISSUE_TRACKER as the tie-break', () => {
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', ...linear, ...github }).name).toBe('linear');
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', ...linear, ...github, ISSUE_TRACKER: 'github' }).name).toBe('github');
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', ...github }).name).toBe('github');
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', ...linear, ISSUE_TRACKER: 'off' }).name).toBe('unconfigured');
  });

  it('names what is missing, and refuses a repository that is not owner/name', () => {
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', ISSUE_TRACKER: 'linear', LINEAR_API_KEY: 'lin_api_0123456789abcdef' }).validateConfig().missing).toEqual(['LINEAR_TEAM']);
    expect(createIssueTrackerProvider({ NODE_ENV: 'production', GITHUB_ISSUES_TOKEN: 'github_pat_0123456789abcdef', GITHUB_ISSUES_REPO: 'https://github.com/a/b' }).name).toBe('unconfigured');
  });
});

describe('Linear', () => {
  const TEAM = { id: 'team-uuid', states: { nodes: [{ id: 'triage-state' }] } };

  it('files into the team’s Triage state, with the key sent as it is', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const query = JSON.parse(call.body as string).query as string;
      if (query.includes('teams(')) return json({ data: { teams: { nodes: [TEAM] } } });
      return json({ data: { issueCreate: { success: true, issue: { identifier: 'WED-12', url: 'https://linear.app/couple/issue/WED-12' } } } });
    });
    const tracker = new LinearIssueTracker({ apiKey: 'lin_api_secret', team: 'wed' }, fetchImpl);
    const created = await tracker.createIssue({ title: 'Bug: x', body: 'body' });
    expect(created).toEqual({ ok: true, value: { key: 'WED-12', url: 'https://linear.app/couple/issue/WED-12', attachmentsStored: 0 } });
    expect(calls[0]!.headers.authorization).toBe('lin_api_secret');
    expect(JSON.parse(calls[0]!.body as string).variables).toEqual({ key: 'WED' });
    expect(JSON.parse(calls[1]!.body as string).variables.input).toEqual({ teamId: 'team-uuid', title: 'Bug: x', description: 'body', stateId: 'triage-state' });
  });

  it('looks a team up by id when given one, and once only', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const query = JSON.parse(call.body as string).query as string;
      if (query.includes('team(id')) return json({ data: { team: { id: 'team-uuid', states: { nodes: [] } } } });
      return json({ data: { issueCreate: { success: true, issue: { identifier: 'WED-1', url: 'https://linear.app/x' } } } });
    });
    const tracker = new LinearIssueTracker({ apiKey: 'k', team: '03f34896-d793-41df-8419-91009894160b', projectId: 'proj' }, fetchImpl);
    await tracker.createIssue({ title: 't', body: 'b' });
    await tracker.createIssue({ title: 't2', body: 'b2' });
    expect(calls.filter((c) => (JSON.parse(c.body as string).query as string).includes('team(id'))).toHaveLength(1);
    // No Triage state on this team: the issue takes the team's default, and the project is set.
    expect(JSON.parse(calls[1]!.body as string).variables.input).toEqual({ teamId: 'team-uuid', title: 't', description: 'b', projectId: 'proj' });
  });

  it('uploads a screenshot to Linear’s own storage and embeds it', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'PUT') return new Response(null, { status: 200 });
      const query = JSON.parse(call.body as string).query as string;
      if (query.includes('teams(')) return json({ data: { teams: { nodes: [TEAM] } } });
      if (query.includes('fileUpload')) return json({ data: { fileUpload: { success: true, uploadFile: { uploadUrl: 'https://uploads.linear.app/put', assetUrl: 'https://uploads.linear.app/asset.png', headers: [{ key: 'x-goog-meta', value: 'v' }] } } } });
      return json({ data: { issueCreate: { success: true, issue: { identifier: 'WED-2', url: 'https://linear.app/x' } } } });
    });
    const tracker = new LinearIssueTracker({ apiKey: 'k', team: 'WED' }, fetchImpl);
    const created = await tracker.createIssue({ title: 't', body: 'b', attachments: [{ filename: 'fb-1.png', contentType: 'image/png', bytes: PNG }] });
    expect(created.ok && created.value.attachmentsStored).toBe(1);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('https://uploads.linear.app/put');
    expect(put.headers).toMatchObject({ 'content-type': 'image/png', 'x-goog-meta': 'v' });
    // The upload goes to storage, not to the API: the key is not sent with it.
    expect(put.headers.authorization).toBeUndefined();
    expect(JSON.parse(calls.at(-1)!.body as string).variables.input.description).toBe('b\n\n![fb-1.png](https://uploads.linear.app/asset.png)');
  });

  it('files the report without the picture when the upload fails', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'PUT') return new Response(null, { status: 403 });
      const query = JSON.parse(call.body as string).query as string;
      if (query.includes('teams(')) return json({ data: { teams: { nodes: [TEAM] } } });
      if (query.includes('fileUpload')) return json({ data: { fileUpload: { success: true, uploadFile: { uploadUrl: 'https://uploads.linear.app/put', assetUrl: 'https://a', headers: [] } } } });
      return json({ data: { issueCreate: { success: true, issue: { identifier: 'WED-3', url: 'https://linear.app/x' } } } });
    });
    const created = await new LinearIssueTracker({ apiKey: 'k', team: 'WED' }, fetchImpl).createIssue({ title: 't', body: 'b', attachments: [{ filename: 'f.png', contentType: 'image/png', bytes: PNG }] });
    expect(created.ok && created.value).toMatchObject({ key: 'WED-3', attachmentsStored: 0 });
    expect(JSON.parse(calls.at(-1)!.body as string).variables.input.description).toContain('could not be stored (auth)');
  });

  it('classifies the ways it can fail', async () => {
    const failing = (res: () => Response | Promise<Response>) => new LinearIssueTracker({ apiKey: 'k', team: 'WED' }, fakeFetch(res).fetchImpl).createIssue({ title: 't', body: 'b' });
    expect(await failing(() => json({}, 401))).toMatchObject({ ok: false, error: { class: 'auth' } });
    expect(await failing(() => json({}, 503))).toMatchObject({ ok: false, error: { class: 'server' } });
    expect(await failing(() => json({ errors: [{ message: 'Argument Validation Error' }] }))).toMatchObject({ ok: false, error: { class: 'bad_request' } });
    expect(await failing(() => json({ data: { teams: { nodes: [] } } }))).toMatchObject({ ok: false, error: { class: 'not_found' } });
    expect(await failing(() => { throw new TypeError('fetch failed'); })).toMatchObject({ ok: false, error: { class: 'network' } });
    expect(await failing(() => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); })).toMatchObject({ ok: false, error: { class: 'timeout' } });
  });

  it('never puts the key in an error message', async () => {
    const failed = await new LinearIssueTracker({ apiKey: 'lin_api_SECRET', team: 'WED' }, fakeFetch(() => json({ errors: [{ message: 'bad' }] })).fetchImpl).createIssue({ title: 't', body: 'b' });
    expect(JSON.stringify(failed)).not.toContain('lin_api_SECRET');
  });
});

describe('GitHub', () => {
  const config = { token: 'github_pat_secret', repo: 'couple/wedding-feedback', labels: ['site-feedback'], allowPublic: false };

  it('files an issue in a private repository', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => (call.method === 'GET' ? json({ private: true }) : json({ number: 131, html_url: 'https://github.com/couple/wedding-feedback/issues/131' }, 201)));
    const created = await new GitHubIssueTracker(config, fetchImpl).createIssue({ title: 'Bug: x', body: 'body' });
    expect(created).toEqual({ ok: true, value: { key: '#131', url: 'https://github.com/couple/wedding-feedback/issues/131', attachmentsStored: 0 } });
    expect(calls[1]!.url).toBe('https://api.github.com/repos/couple/wedding-feedback/issues');
    expect(calls[1]!.headers).toMatchObject({ authorization: 'Bearer github_pat_secret', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ title: 'Bug: x', body: 'body', labels: ['site-feedback'] });
  });

  it('refuses a public repository, without creating anything', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ private: false }));
    const tracker = new GitHubIssueTracker(config, fetchImpl);
    const refused = await tracker.createIssue({ title: 't', body: 'b' });
    expect(refused).toMatchObject({ ok: false, error: { class: 'unconfigured' } });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect((await tracker.health()).status).toBe('down');
  });

  it('treats a repository whose visibility it cannot read as public', async () => {
    const refused = await new GitHubIssueTracker(config, fakeFetch(() => json({})).fetchImpl).createIssue({ title: 't', body: 'b' });
    expect(refused).toMatchObject({ ok: false, error: { class: 'unconfigured' } });
  });

  it('files in a public repository only when the couple said so, and warns', async () => {
    const { fetchImpl } = fakeFetch((call) => (call.method === 'GET' ? json({ private: false }) : json({ number: 1, html_url: 'https://github.com/x/y/issues/1' }, 201)));
    const tracker = new GitHubIssueTracker({ ...config, allowPublic: true }, fetchImpl);
    expect((await tracker.createIssue({ title: 't', body: 'b' })).ok).toBe(true);
    expect(tracker.validateConfig().warnings).toHaveLength(1);
  });

  it('says a screenshot was sent, because GitHub has nowhere to put one', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => (call.method === 'GET' ? json({ private: true }) : json({ number: 2, html_url: 'https://github.com/x/y/issues/2' }, 201)));
    const tracker = new GitHubIssueTracker(config, fetchImpl);
    expect(tracker.capabilities.attachments).toBe(false);
    const created = await tracker.createIssue({ title: 't', body: 'b', attachments: [{ filename: 'f.png', contentType: 'image/png', bytes: PNG }] });
    expect(created.ok && created.value.attachmentsStored).toBe(0);
    expect(JSON.parse(calls[1]!.body as string).body).toContain('A screenshot was sent with this report');
  });

  it('files without labels rather than not at all when the labels are refused', async () => {
    let posts = 0;
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.method === 'GET') return json({ private: true });
      posts += 1;
      return posts === 1 ? json({ message: 'Validation Failed' }, 422) : json({ number: 3, html_url: 'https://github.com/x/y/issues/3' }, 201);
    });
    const created = await new GitHubIssueTracker(config, fetchImpl).createIssue({ title: 't', body: 'b' });
    expect(created.ok && created.value.key).toBe('#3');
    expect(JSON.parse(calls.at(-1)!.body as string)).toEqual({ title: 't', body: 'b' });
  });

  it('classifies the ways it can fail, and carries Retry-After', async () => {
    const failing = (res: () => Response | Promise<Response>) => new GitHubIssueTracker(config, fakeFetch(res).fetchImpl).createIssue({ title: 't', body: 'b' });
    expect(await failing(() => json({}, 401))).toMatchObject({ ok: false, error: { class: 'auth' } });
    expect(await failing(() => json({}, 404))).toMatchObject({ ok: false, error: { class: 'not_found' } });
    expect(await failing(() => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }))).toMatchObject({ ok: false, error: { class: 'rate_limited', retryAfterMs: 30_000 } });
    expect(await failing(() => { throw new TypeError('fetch failed'); })).toMatchObject({ ok: false, error: { class: 'network' } });
  });
});

describe('the mock', () => {
  it('keeps what it was given and can be told to fail', async () => {
    const mock = new MockIssueTracker();
    mock.failNext = 1;
    expect((await mock.createIssue({ title: 'a', body: 'b' })).ok).toBe(false);
    const created = await mock.createIssue({ title: 'a', body: 'b' });
    expect(created.ok && created.value.key).toBe('MOCK-1');
    expect(mock.issues).toHaveLength(1);
  });
});
