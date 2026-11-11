import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { totalsOf } from '@/domain/guests/sheet-totals';
import { createGuestSheetProvider, GoogleSheetsGuestSheet, MOCK_GUEST_SHEET_VALUES, parseGuestSheet } from '@/providers/guest-sheet';

const HEADER = ['Family/Group Names', 'Total Adults', 'Total Kids', 'Plus 1', 'Guest Of', 'Group', 'Priority', 'Address', 'Email', 'Phone', 'Save the Date Sent', 'Invite Sent', 'RSVP', 'Table Number', 'Menu Choice', 'Dietary Restrictions', 'Notes'];

describe('parseGuestSheet', () => {
  it('reads the planning columns by header and never maps contact details, dietary needs or notes', () => {
    const parsed = parseGuestSheet([
      HEADER,
      ['Test household', '2', '1', '', 'Bride', 'Friend', '2', '1 Test St', 'test@example.test', '555-0100', 'Yes', 'No', 'Pending', '4', 'Fish', 'Peanuts', 'Secret note'],
    ]);
    expect(parsed.rows).toEqual([
      { sheetRow: 2, name: 'Test household', adults: 2, kids: 1, plusOnes: 0, guestOf: 'Bride', group: 'Friend', priority: 2, saveTheDateSent: 'Yes', inviteSent: 'No', rsvp: 'Pending', table: '4', menu: 'Fish' },
    ]);
    expect(JSON.stringify(parsed.rows)).not.toMatch(/Test St|example\.test|555-0100|Peanuts|Secret note/);
    expect(parsed.withheldColumns).toEqual(['Address', 'Email', 'Phone', 'Dietary Restrictions', 'Notes']);
    expect(parsed.missingColumns).toEqual([]);
  });

  it('follows the headers when columns move', () => {
    const parsed = parseGuestSheet([
      ['Priority', 'Guest Of', 'Family/Group Names', 'Total Adults'],
      ['1', 'Groom', 'Moved household', '3'],
    ]);
    expect(parsed.rows[0]).toMatchObject({ name: 'Moved household', adults: 3, guestOf: 'Groom', priority: 1 });
    expect(parsed.missingColumns).toContain('total kids');
  });

  it('stops at the first blank line, so the tallies kept below the list are not read as households', () => {
    const parsed = parseGuestSheet(MOCK_GUEST_SHEET_VALUES);
    expect(parsed.rows.map((r) => r.name)).toEqual(['Sample household A', 'Sample household B', 'Sample household C']);
  });

  it('skips a line with nobody named on it', () => {
    const parsed = parseGuestSheet([HEADER, ['', '', '', '', 'Bride', 'Family Friend', '5'], ['Named', '1']]);
    expect(parsed.rows.map((r) => [r.name, r.sheetRow])).toEqual([['Named', 3]]);
  });

  it('counts a plus-one ticked as "Yes", "x" or a tick as one person', () => {
    const r = parseGuestSheet([HEADER, ['A', '1', '0', 'Yes'], ['B', '1', '0', 'x'], ['C', '1', '0', '\u2713'], ['D', '1', '0', 'No']]);
    expect(r.rows.map((x) => x.plusOnes)).toEqual([1, 1, 1, 0]);
  });

  it('treats blanks and junk as zero heads and no priority', () => {
    const [row] = parseGuestSheet([HEADER, ['Odd', 'two', '', '1', '', '', 'high']]).rows;
    expect(row).toMatchObject({ adults: 0, kids: 0, plusOnes: 1, priority: null, guestOf: null });
  });
});

describe('totalsOf', () => {
  it('counts heads and keeps a running total by priority', () => {
    const { rows } = parseGuestSheet([HEADER, ['A', '2', '', '', '', '', '1'], ['B', '2', '2', '', '', '', '2'], ['C', '1', '', '1', '', '', '2'], ['D', '1', '', '', '', '', '']]);
    const t = totalsOf(rows);
    expect(t).toMatchObject({ households: 4, adults: 6, kids: 2, plusOnes: 1, people: 9 });
    expect(t.byPriority).toEqual([
      { priority: 1, households: 1, people: 2, cumulativePeople: 2 },
      { priority: 2, households: 2, people: 6, cumulativePeople: 8 },
    ]);
  });
});

describe('createGuestSheetProvider', () => {
  const none = { FORCE_MOCK_PROVIDERS: false, GUEST_SHEET_ID: undefined, GUEST_SHEET_RANGE: 'Guests', GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: undefined, GUEST_SHEET_CACHE_SECONDS: 120 };

  it('uses sample rows in development and says "not connected" in production', async () => {
    const dev = createGuestSheetProvider(none);
    expect(dev.mode).toBe('mock');
    const read = await dev.read();
    expect(read.ok && read.value.data.sample).toBe(true);

    const prod = createGuestSheetProvider({ ...none, isProduction: true });
    expect(prod.mode).toBe('unavailable');
    const refused = await prod.read();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.class).toBe('unconfigured');
  });

  it('names what is missing when the setup is only partly done, even in development', () => {
    const p = createGuestSheetProvider({ ...none, GUEST_SHEET_ID: 'sheet123' });
    expect(p.mode).toBe('unavailable');
    expect(p.validateConfig().missing).toEqual(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']);
  });
});

describe('GoogleSheetsGuestSheet', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  function fakeGoogle(values: unknown[][], opts: { sheetStatus?: number } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      if (opts.sheetStatus && opts.sheetStatus !== 200) return new Response('{"error":{}}', { status: opts.sheetStatus });
      return Response.json({ range: 'Guests!A1:Z100', majorDimension: 'ROWS', values });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  const config = (cacheSeconds = 120) => ({ sheetId: 'sheet-id_1', range: 'Guests', clientEmail: 'site@project.iam.gserviceaccount.com', privateKey: pem.replace(/\n/g, '\\n'), cacheSeconds });

  it('signs a read-only service-account JWT and reads the tab', async () => {
    const g = fakeGoogle([HEADER, ['Live household', '2']]);
    const p = new GoogleSheetsGuestSheet(config(), { fetch: g.fetchImpl });
    const r = await p.read();
    expect(r.ok && r.value.data.rows.map((x) => x.name)).toEqual(['Live household']);
    expect(p.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/sheet-id_1/edit');

    const assertion = new URLSearchParams(String(g.calls[0]!.init?.body)).get('assertion')!;
    const [h, c, sig] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'site@project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token' });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig!, 'base64url')).toBe(true);

    expect(g.calls[1]!.url).toBe('https://sheets.googleapis.com/v4/spreadsheets/sheet-id_1/values/Guests?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE');
    expect((g.calls[1]!.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('reuses a read within the cache window, and `fresh` skips it', async () => {
    let now = 1_000_000;
    const g = fakeGoogle([HEADER, ['A', '1']]);
    const p = new GoogleSheetsGuestSheet(config(120), { fetch: g.fetchImpl, now: () => now });
    await p.read();
    now += 60_000;
    await p.read();
    expect(g.calls.filter((c) => c.url.includes('sheets.googleapis.com'))).toHaveLength(1);
    await p.read({ fresh: true });
    now += 121_000;
    await p.read();
    expect(g.calls.filter((c) => c.url.includes('sheets.googleapis.com'))).toHaveLength(3);
    // The token is fetched once and reused while it is valid.
    expect(g.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
  });

  it('explains a sheet that is not shared with the account', async () => {
    const g = fakeGoogle([], { sheetStatus: 403 });
    const r = await new GoogleSheetsGuestSheet(config(), { fetch: g.fetchImpl }).read();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.class).toBe('auth');
      expect(r.error.message).toMatch(/shared with the service account/);
    }
  });

  it('serves the last good read, marked stale, when Google fails afterwards', async () => {
    let status = 200;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      return status === 200 ? Response.json({ values: [HEADER, ['Kept', '2']] }) : new Response('down', { status });
    }) as typeof fetch;
    const p = new GoogleSheetsGuestSheet(config(0), { fetch: fetchImpl });
    expect((await p.read()).ok).toBe(true);
    status = 503;
    const r = await p.read();
    expect(r.ok && r.value.data.stale).toBe(true);
    expect(r.ok && r.value.data.rows[0]!.name).toBe('Kept');
  });

  it('leaves Google alone for a while after a failure, and a refresh still asks', async () => {
    let now = 1_000_000;
    let status = 200;
    let sheetCalls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
      sheetCalls++;
      return status === 200 ? Response.json({ values: [HEADER, ['Kept', '2']] }) : new Response('limited', { status });
    }) as typeof fetch;
    const p = new GoogleSheetsGuestSheet(config(0), { fetch: fetchImpl, now: () => now });
    await p.read();
    status = 429;
    expect((await p.read()).ok).toBe(true); // stale, after one failed call
    expect(sheetCalls).toBe(2);
    // Google asked for a minute: page views inside it are served the last read without calling.
    now += 30_000;
    const r = await p.read();
    expect(r.ok && r.value.data.stale).toBe(true);
    expect(sheetCalls).toBe(2);
    await p.read({ fresh: true });
    expect(sheetCalls).toBe(3);
    status = 200;
    now += 61_000;
    const back = await p.read();
    expect(back.ok && back.value.data.stale).toBe(false);
    expect(sheetCalls).toBe(4);
  });

  it('gets a new token after Google refuses the one it has', async () => {
    let refuse = true;
    let tokens = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: `tok${++tokens}`, expires_in: 3600 });
      return refuse ? new Response('{}', { status: 401 }) : Response.json({ values: [HEADER, ['A', '1']] });
    }) as typeof fetch;
    const p = new GoogleSheetsGuestSheet(config(0), { fetch: fetchImpl });
    expect((await p.read()).ok).toBe(false);
    refuse = false;
    expect((await p.read({ fresh: true })).ok).toBe(true);
    expect(tokens).toBe(2);
  });

  it('reports a key it cannot use without calling Google', async () => {
    const g = fakeGoogle([]);
    const r = await new GoogleSheetsGuestSheet({ ...config(), privateKey: 'not a key' }, { fetch: g.fetchImpl }).read();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.class).toBe('auth');
    expect(g.calls).toHaveLength(0);
  });
});
