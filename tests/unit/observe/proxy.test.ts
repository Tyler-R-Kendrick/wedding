import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReplayUrl, observeConfig } from '@/lib/observe/config';

const TOKEN = 'phc_0123456789abcdefghijklmnopqrstuvwxyzABCD';

describe('observeConfig', () => {
  it('is off without a project token, or with something that is not one', () => {
    expect(observeConfig(undefined, undefined)).toBeNull();
    expect(observeConfig('', 'https://us.i.posthog.com')).toBeNull();
    expect(observeConfig('phx_a_personal_api_key_must_never_be_here', undefined)).toBeNull();
  });

  it('knows the two regions and nothing else, whatever the host variable says', () => {
    expect(observeConfig(TOKEN, undefined)).toMatchObject({ region: 'us', ingestHost: 'us.i.posthog.com', assetsHost: 'us-assets.i.posthog.com', uiHost: 'https://us.posthog.com' });
    expect(observeConfig(TOKEN, 'https://eu.i.posthog.com')).toMatchObject({ region: 'eu', ingestHost: 'eu.i.posthog.com', assetsHost: 'eu-assets.i.posthog.com', uiHost: 'https://eu.posthog.com' });
    expect(observeConfig(TOKEN, 'https://attacker.example')?.ingestHost).toBe('us.i.posthog.com');
  });

  it('accepts a replay link only into the PostHog app', () => {
    expect(isReplayUrl('https://us.posthog.com/project/1/replay/abc?t=3')).toBe(true);
    expect(isReplayUrl('https://eu.posthog.com/replay/abc')).toBe(true);
    for (const bad of ['http://us.posthog.com/replay/a', 'https://us.posthog.com.evil.example/replay/a', 'https://us.posthog.com/project/1/insights', 'javascript:alert(1)', 42, null]) expect(isReplayUrl(bad)).toBe(false);
  });
});

describe('the proxy route', () => {
  const upstream = vi.fn<(input: URL | string, init?: RequestInit) => Promise<Response>>();
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  let route: typeof import('@/app/api/observe/[...path]/route');

  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', TOKEN);
    vi.stubGlobal('fetch', upstream);
    upstream.mockReset();
    upstream.mockResolvedValue(new Response('{"status":1}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'ph=1', 'x-internal': 'y' } }));
    route = await import('@/app/api/observe/[...path]/route');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const sent = () => {
    const [url, init] = upstream.mock.calls[0]!;
    return { url: String(url), headers: Object.fromEntries(new Headers(init?.headers as HeadersInit).entries()), init };
  };

  it('is not there at all when PostHog is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', '');
    const res = await route.POST(new Request('https://kendrick.wedding/api/observe/e', { method: 'POST', body: '{}' }), context(['e']));
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('passes events to the ingestion host, with the trailing slash PostHog expects and the query kept', async () => {
    await route.POST(new Request('https://kendrick.wedding/api/observe/e?ip=0&_=1&compression=gzip-js', { method: 'POST', body: 'payload' }), context(['e']));
    expect(sent().url).toBe('https://us.i.posthog.com/e/?ip=0&_=1&compression=gzip-js');
  });

  it('passes the SDK’s own files to the assets host, as named', async () => {
    await route.GET(new Request(`https://kendrick.wedding/api/observe/array/${TOKEN}/config`), context(['array', TOKEN, 'config']));
    expect(sent().url).toBe(`https://us-assets.i.posthog.com/array/${TOKEN}/config`);
  });

  it('never forwards the guest’s cookies, a site Authorization, or their address', async () => {
    await route.POST(
      new Request('https://kendrick.wedding/api/observe/s', {
        method: 'POST',
        body: 'recording',
        headers: {
          cookie: 'wedding.session_token=SECRET; wedding.reporter=PASS',
          authorization: 'Bearer a-site-session-token',
          'x-forwarded-for': '203.0.113.9',
          'x-real-ip': '203.0.113.9',
          'content-type': 'text/plain',
          'content-encoding': 'gzip',
          'user-agent': 'Mozilla/5.0',
          'posthog-sdk-info': 'web/1.450.0',
        },
      }),
      context(['s']),
    );
    const { headers } = sent();
    expect(headers).toEqual({ 'content-type': 'text/plain', 'content-encoding': 'gzip', 'user-agent': 'Mozilla/5.0', 'posthog-sdk-info': 'web/1.450.0' });
    expect(JSON.stringify(headers)).not.toMatch(/SECRET|PASS|203\.0\.113\.9|a-site-session-token/);
  });

  it('forwards an Authorization only when it is a PostHog project token', async () => {
    await route.POST(new Request('https://kendrick.wedding/api/observe/i/v1/e', { method: 'POST', body: '{}', headers: { authorization: `Bearer ${TOKEN}` } }), context(['i', 'v1', 'e']));
    expect(sent().headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('hands back the answer without PostHog’s cookies or stray headers', async () => {
    const res = await route.POST(new Request('https://kendrick.wedding/api/observe/e', { method: 'POST', body: '{}' }), context(['e']));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":1}');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-internal')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('cannot be steered to another host or out of its path', async () => {
    await route.GET(new Request('https://kendrick.wedding/api/observe/x'), context(['@evil.example', 'a b', '%2e%2e']));
    expect(new URL(sent().url).hostname).toBe('us.i.posthog.com');
    upstream.mockClear();
    expect((await route.GET(new Request('https://kendrick.wedding/api/observe/x'), context(['..', 'admin']))).status).toBe(404);
    expect((await route.GET(new Request('https://kendrick.wedding/api/observe/x'), context([]))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a body larger than the platform will carry, and answers 502 when PostHog is down', async () => {
    const big = await route.POST(new Request('https://kendrick.wedding/api/observe/s', { method: 'POST', body: 'x', headers: { 'content-length': '5000000' } }), context(['s']));
    expect(big.status).toBe(413);
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'));
    const down = await route.POST(new Request('https://kendrick.wedding/api/observe/e', { method: 'POST', body: '{}' }), context(['e']));
    expect(down.status).toBe(502);
  });
});

describe('what leaves the browser in an event', () => {
  const ORIGIN = 'https://kendrick.wedding';

  it('loses query values from every address it carries', async () => {
    const { scrubEvent } = await import('@/lib/observe/scrub-event');
    const event = scrubEvent({ event: '$pageview', properties: { $current_url: `${ORIGIN}/rsvp?t=SECRET&preview=RSVP_OPEN`, $referrer: 'https://mail.example/inbox?id=9', other: 'kept' }, $set_once: { $initial_current_url: `${ORIGIN}/i/01HZX4K9M2N8P7Q6R5S4T3V2W1?x=1` } }, ORIGIN);
    expect(event.properties).toEqual({ $current_url: `${ORIGIN}/rsvp?t&preview`, $referrer: 'https://mail.example', other: 'kept' });
    expect(event.$set_once).toEqual({ $initial_current_url: `${ORIGIN}/i/:id?x` });
  });

  it('keeps the concierge event’s numbers and drops what the guest asked and was told', async () => {
    const { scrubEvent } = await import('@/lib/observe/scrub-event');
    const event = scrubEvent(
      { event: '$ai_generation', properties: { $ai_model: 'browser:prompt-api', $ai_latency: 1.2, $ai_input_tokens: 40, $ai_input: [{ role: 'user', content: 'Is my aunt at table 4?' }], $ai_output_choices: [{ role: 'assistant', content: 'Yes.' }] } },
      ORIGIN,
    );
    expect(event.properties).toEqual({ $ai_model: 'browser:prompt-api', $ai_latency: 1.2, $ai_input_tokens: 40 });
  });

  it('leaves other events’ properties alone, and passes null through', async () => {
    const { scrubEvent } = await import('@/lib/observe/scrub-event');
    expect(scrubEvent({ event: 'rsvp_submitted', properties: { event_count: 2, $ai_input: 'not an ai event' } }, ORIGIN).properties).toEqual({ event_count: 2, $ai_input: 'not an ai event' });
    expect(scrubEvent(null, ORIGIN)).toBeNull();
  });
});
