import { describe, expect, it } from 'vitest';
import { authorizationCandidates, ConnectTwilioVerify, type ConnectTokenAnswer } from '@/providers/twilio-verify/connect';

const AC = `AC${'a'.repeat(32)}`;
const SK = `SK${'b'.repeat(32)}`;
const VA = `VA${'c'.repeat(32)}`;
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
/** Nothing but the injected fakes is asked: no connector settings, no other connectors. */
const OFFLINE = { getMetadata: async () => undefined, discover: async () => [] as string[] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stand-in for Twilio that accepts exactly one Authorization header and records what it was asked. */
function twilio(accepts: string, services: { sid: string }[] = [{ sid: VA }]) {
  const calls: { url: string; method: string; authorization: string; body: string }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = String((init?.headers as Record<string, string>).Authorization);
    const body = init?.body ? String(init.body) : '';
    calls.push({ url, method: init?.method ?? 'GET', authorization, body });
    if (authorization !== accepts) return json(401, { message: 'Authenticate' });
    if (url.endsWith('/Services?PageSize=20')) return json(200, { services });
    if (url.endsWith('/Services') && init?.method === 'POST') return json(201, { sid: VA });
    if (url.endsWith('/Verifications')) return json(201, { sid: 'VE1', status: 'pending' });
    if (url.endsWith('/VerificationCheck')) return body.includes('Code=123456') ? json(200, { sid: 'VE1', status: 'approved' }) : json(404, { message: 'not found' });
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('how a connector token is presented to Twilio', () => {
  it('tries the forms the answer could mean, most likely first', () => {
    expect(authorizationCandidates({ token: 'secret', tenantId: AC })).toEqual([basic(AC, 'secret'), 'Bearer secret']);
    // An API key before the account: a key secret only works with its own key SID.
    expect(authorizationCandidates({ token: 'secret', tenantId: AC, metadata: { apiKeySid: SK } })).toEqual([basic(SK, 'secret'), basic(AC, 'secret'), 'Bearer secret']);
    expect(authorizationCandidates({ token: 'aaa.bbb.ccc', externalSubject: AC })[0]).toBe('Bearer aaa.bbb.ccc');
    expect(authorizationCandidates({ token: `${AC}:secret` })[0]).toBe(basic(AC, 'secret'));
    expect(authorizationCandidates({ token: 'secret' })).toEqual(['Bearer secret']);
  });
});

describe('Twilio Verify through the Vercel connector', () => {
  const answer: ConnectTokenAnswer = { token: 'secret', tenantId: AC };

  it('sends and checks a code with the header form Twilio accepts, and remembers it', async () => {
    const { fetchImpl, calls } = twilio(basic(AC, 'secret'));
    const provider = new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => answer, fetchImpl });

    const sent = await provider.startVerification({ to: '+13125550100' });
    expect(sent).toEqual({ ok: true, value: { sid: 'VE1', status: 'pending' } });
    const post = calls.find((c) => c.url.endsWith('/Verifications'))!;
    expect(post.url).toBe(`https://verify.twilio.com/v2/Services/${VA}/Verifications`);
    expect(post.body).toBe('To=%2B13125550100&Channel=sms');

    expect(await provider.checkVerification({ to: '+13125550100', code: '123456' })).toEqual({ ok: true });
    expect(await provider.checkVerification({ to: '+13125550100', code: '000000' })).toMatchObject({ ok: false, error: { class: 'not_found' } });
    // The service was looked up once, and nothing was refused after the first accepted header.
    expect(calls.filter((c) => c.url.includes('PageSize'))).toHaveLength(1);
    expect(calls.every((c) => c.authorization === basic(AC, 'secret'))).toBe(true);
  });

  it('falls back to the next header form when Twilio refuses the first, then stops trying the first', async () => {
    const { fetchImpl, calls } = twilio('Bearer secret');
    const provider = new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => answer, fetchImpl, serviceSid: VA });
    expect((await provider.startVerification({ to: '+13125550100' })).ok).toBe(true);
    expect(calls.map((c) => c.authorization)).toEqual([basic(AC, 'secret'), 'Bearer secret']);
    await provider.startVerification({ to: '+13125550100' });
    expect(calls.at(-1)!.authorization).toBe('Bearer secret');
    expect(calls).toHaveLength(3);
  });

  it('asks as the app first, then as each user, and keeps the one that answers', async () => {
    const asked: string[] = [];
    const { fetchImpl } = twilio(basic(AC, 'secret'));
    const provider = new ConnectTwilioVerify({ ...OFFLINE,
      userIds: [undefined, 'user_1', 'user_1'],
      fetchImpl,
      getTokenResponse: async (_connector, { subject }) => {
        asked.push(subject.type === 'user' ? `user:${subject.id}` : 'app');
        if (subject.type === 'app') throw Object.assign(new Error('installation required'), { name: 'ConnectorInstallationRequiredError' });
        return answer;
      },
    });
    expect(await provider.ready()).toEqual({ ok: true });
    await provider.startVerification({ to: '+13125550100' });
    expect(asked[0]).toBe('app');
    expect(asked.slice(1).every((s) => s === 'user:user_1')).toBe(true);
  });

  it('uses the pinned Verify service without looking one up, and creates one when the account has none', async () => {
    const pinned = twilio(basic(AC, 'secret'));
    await new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => answer, fetchImpl: pinned.fetchImpl, serviceSid: 'VApinned' }).startVerification({ to: '+13125550100' });
    expect(pinned.calls.map((c) => c.url)).toEqual(['https://verify.twilio.com/v2/Services/VApinned/Verifications']);

    const empty = twilio(basic(AC, 'secret'), []);
    expect(await new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => answer, fetchImpl: empty.fetchImpl }).ready()).toEqual({ ok: true });
    const created = empty.calls.find((c) => c.method === 'POST')!;
    expect(created.url).toBe('https://verify.twilio.com/v2/Services');
    expect(created.body).toContain('FriendlyName=Sara+%2B+Tyler');
  });

  it('says why it cannot send, without throwing, when the connector gives no token', async () => {
    const provider = new ConnectTwilioVerify({ ...OFFLINE,
      connector: 'twilio/wedding',
      getTokenResponse: async () => {
        throw Object.assign(new Error('Connector not found'), { name: 'ConnectError', code: 'connector_not_found', status: 404 });
      },
      fetchImpl: twilio('never').fetchImpl,
    });
    const ready = await provider.ready();
    expect(ready.ok).toBe(false);
    expect(ready.ok ? '' : ready.reason).toContain('twilio/wedding');
    expect(ready.ok ? '' : ready.reason).toContain('connector_not_found');
    expect(await provider.startVerification({ to: '+13125550100' })).toMatchObject({ ok: false, error: { class: 'auth', message: 'Verification service unavailable.' } });
  });

  it('reports Twilio refusing every header form as a failure, not a crash', async () => {
    const { fetchImpl } = twilio('nothing matches');
    const provider = new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => answer, fetchImpl });
    expect((await provider.ready()).ok).toBe(false);
    expect((await provider.startVerification({ to: '+13125550100' })).ok).toBe(false);
  });

  it('reads the account SID from the connector\'s settings when the token answer has none', async () => {
    const { fetchImpl, calls } = twilio(basic(AC, 'secret'));
    const provider = new ConnectTwilioVerify({ ...OFFLINE, getTokenResponse: async () => ({ token: 'secret' }), getMetadata: async () => ({ account: { sid: AC } }), fetchImpl, serviceSid: VA });
    expect((await provider.startVerification({ to: '+13125550100' })).ok).toBe(true);
    expect(calls[0]!.authorization).toBe(basic(AC, 'secret'));
  });

  it('uses another Twilio connector of the project when the named one does not exist, and keeps it', async () => {
    const asked: string[] = [];
    const { fetchImpl } = twilio(basic(AC, 'secret'));
    const provider = new ConnectTwilioVerify({
      ...OFFLINE,
      connector: 'twilio/wedding',
      discover: async () => ['twilio/wedding', 'twilio/sms'],
      fetchImpl,
      getTokenResponse: async (connector) => {
        asked.push(connector);
        if (connector !== 'twilio/sms') throw Object.assign(new Error('Connector not found'), { code: 'connector_not_found', status: 404 });
        return answer;
      },
    });
    expect(await provider.ready()).toEqual({ ok: true });
    await provider.startVerification({ to: '+13125550100' });
    expect(asked[0]).toBe('twilio/wedding');
    expect(asked.slice(1).every((c) => c === 'twilio/sms')).toBe(true);
  });
});
