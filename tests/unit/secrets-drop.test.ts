import { describe, expect, it } from 'vitest';
// The Secret Drop tooling is plain ESM under scripts/ so it can run in a bare sandbox
// (no build, no tsx) — the tests import it the same way the scripts do.
import { mergeEnv, parseDotenv, presentNames, quote } from '../../scripts/secrets/env-file.mjs';
import { AUTOFILL, CEREMONY, METHOD_CEREMONY, METHOD_RANK, NEED, SLOTS, allVars, ceremonyOf, chosenOption, clientRegistry, recommendedOf } from '../../scripts/secrets/registry.mjs';
import { COMMANDS, FILES, collections, run, writeDoc } from '../../scripts/secrets/serve.mjs';

describe('dotenv parsing', () => {
  it('reads export prefixes, comments and both quote styles', () => {
    const env = parseDotenv([
      '# a comment',
      '',
      'export PLAIN=one',
      'QUOTED="two words"',
      "SINGLE='has#hash'",
      'TRAILING=bare # not part of the value',
      'EMPTY=',
    ].join('\n'));
    expect(env.get('PLAIN')).toBe('one');
    expect(env.get('QUOTED')).toBe('two words');
    expect(env.get('SINGLE')).toBe('has#hash');
    expect(env.get('TRAILING')).toBe('bare');
    expect(env.get('EMPTY')).toBe('');
  });

  it('keeps multi-line double-quoted values together', () => {
    const env = parseDotenv('KEY="-----BEGIN-----\nline two\n-----END-----"\nAFTER=1\n');
    expect(env.get('KEY')).toBe('-----BEGIN-----\nline two\n-----END-----');
    expect(env.get('AFTER')).toBe('1');
  });

  it('tolerates CRLF and ignores lines that are not assignments', () => {
    const env = parseDotenv('A=1\r\nnot an assignment\r\nlower_case=2\r\nB=3\r\n');
    expect([...env.keys()]).toEqual(['A', 'B']);
  });

  it('counts only variables that carry a value as present', () => {
    expect([...presentNames('SET=x\nUNSET=\nQUOTED_EMPTY=""\n')]).toEqual(['SET']);
  });
});

describe('env file writing', () => {
  it('quotes only what a shell could misread', () => {
    expect(quote('postgres://u:p@host:5432/db')).toBe('postgres://u:p@host:5432/db');
    expect(quote('two words')).toBe('"two words"');
    expect(quote('has"quote')).toBe('"has\\"quote"');
  });

  it('rewrites existing assignments in place and appends the rest', () => {
    const { text, updated, added } = mergeEnv('# header\nEXISTING=old\nOTHER=keep\n', new Map([['EXISTING', 'new'], ['FRESH', 'v']]));
    expect(updated).toEqual(['EXISTING']);
    expect(added).toEqual(['FRESH']);
    expect(text).toContain('EXISTING=new');
    expect(text).toContain('OTHER=keep');
    expect(text).toMatch(/FRESH=v\n$/);
    expect(text).not.toContain('EXISTING=old');
  });

  it('round-trips a value that needs quoting', () => {
    const { text } = mergeEnv('', new Map([['V', 'a b#c"d']]));
    expect(parseDotenv(text).get('V')).toBe('a b#c"d');
  });

  it('preserves `export` lines it does not touch', () => {
    const { text } = mergeEnv('export KEEP=1\n', new Map([['NEW', '2']]));
    expect(text).toContain('export KEEP=1');
  });
});

describe('the concierge defaults to nobody\'s account', () => {
  const concierge = SLOTS.find((s) => s.id === 'concierge')!;

  it('offers the guest\'s own browser first, and recommends it', () => {
    // Cheapest possible answer to "which model": none. No key exists, nothing is billed, and
    // the question never leaves the guest's device.
    expect(concierge.options[0]?.id).toBe('browser');
    expect(concierge.options[0]?.recommended).toBe(true);
    expect(concierge.options[0]?.secrets).toEqual([]);
    expect(ceremonyOf(concierge.options[0]!)).toBe('agent');
  });

  it('offers a harness you are already signed in to before any account is asked for', () => {
    const ids = concierge.options.map((o) => o.id);
    expect(ids[1]).toBe('harness');
    expect(ids.indexOf('harness')).toBeLessThan(ids.indexOf('anthropic'));
    const harness = concierge.options[1]!;
    expect(harness.secrets, 'borrowing asks for nothing').toEqual([]);
    expect(ceremonyOf(harness)).toBe('agent');
  });

  it('lists OpenRouter among the hosted options', () => {
    expect(concierge.options.map((o) => o.id)).toContain('openrouter');
  });

  it('ranks borrowing above every rung that needs an account', () => {
    expect(METHOD_RANK.harness).toBeLessThan(METHOD_RANK.authmd);
    expect(METHOD_RANK.harness).toBeLessThan(METHOD_RANK.oauth);
    expect(METHOD_RANK.harness).toBeLessThan(METHOD_RANK.browser);
    expect(METHOD_CEREMONY.harness).toBe('agent');
  });
});

describe('slots and their provider options', () => {
  it('offers a real choice wherever one exists, with exactly one recommendation', () => {
    for (const slot of SLOTS) {
      expect(slot.options.length, `${slot.id} has no options`).toBeGreaterThan(0);
      const recommended = slot.options.filter((o) => o.recommended);
      expect(recommended.length, `${slot.id} must recommend exactly one option`).toBe(1);
      expect(recommendedOf(slot).id).toBe(recommended[0]?.id);
    }
  });

  it('gives storage several providers, because that choice is a real one', () => {
    const storage = SLOTS.find((s) => s.id === 'storage');
    expect(storage?.options.map((o) => o.id)).toEqual(expect.arrayContaining(['r2', 'aws', 'b2', 'supabase-storage', 'minio']));
  });

  it('never asks for a setting the choice already determines', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        const asked = new Set(option.secrets);
        for (const inferred of Object.keys(option.fills)) {
          expect(asked.has(inferred), `${slot.id}/${option.id} both infers and asks for ${inferred}`).toBe(false);
        }
      }
    }
  });

  it('states a ceremony a person can actually be offered', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        expect(Object.keys(CEREMONY), `${slot.id}/${option.id}`).toContain(ceremonyOf(option));
        // Anything that needs no key must not ask for one, and vice versa.
        if (ceremonyOf(option) === 'paste') expect(option.secrets.length, `${option.id} pastes nothing`).toBeGreaterThan(0);
        if (option.isOptOut) expect(option.secrets).toHaveLength(0);
      }
    }
  });

  it('ends in a human fallback exactly when there is something a human could supply', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        expect(option.ladder.length, `${option.id} has no ladder`).toBeGreaterThan(0);
        const ranks = option.ladder.map((step: { method: string }) => METHOD_RANK[step.method as keyof typeof METHOD_RANK]);
        expect(ranks, `${option.id} ladder is out of order`).toEqual([...ranks].sort((a, b) => a - b));
        const last = option.ladder.at(-1)?.method;
        // An option that asks for no secret — the on-device model, an opt-out — has nothing to
        // paste, so ending at a hands-free rung is correct. Anything that asks for one must
        // leave a way for a person to provide it.
        const expected = option.secrets.length ? ['manual'] : ['derive', 'generate', 'manual'];
        expect(expected, `${slot.id}/${option.id} ends at ${last}`).toContain(last);
      }
    }
  });

  it('maps every ladder method to a ceremony a person understands', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        for (const step of option.ladder) {
          expect(METHOD_CEREMONY[step.method as keyof typeof METHOD_CEREMONY], `${option.id}: ${step.method}`).toBeDefined();
        }
      }
    }
  });

  it('keeps sandbox-generated material out of the slots entirely', () => {
    const generated = new Set(Object.keys(AUTOFILL));
    for (const v of allVars()) expect(generated.has(v), `${v} is both auto-filled and asked for`).toBe(false);
  });

  it('declares a need the repo can justify', () => {
    for (const slot of SLOTS) expect(Object.keys(NEED), `${slot.id}`).toContain(slot.need);
  });

  it('falls back to the recommendation when no choice has been made', () => {
    const storage = SLOTS.find((s) => s.id === 'storage')!;
    expect(chosenOption(storage, {}).id).toBe('r2');
    expect(chosenOption(storage, { storage: 'b2' }).id).toBe('b2');
    expect(chosenOption(storage, { storage: 'nonsense' }).id).toBe('r2');
  });

  it('exports a page registry with no functions in it', () => {
    const client = clientRegistry();
    expect(JSON.parse(JSON.stringify(client))).toEqual(client);
    expect(client.slots).toHaveLength(SLOTS.length);
  });
});

describe('planning without asking', () => {
  it('plans every slot the site needs, with no arguments at all', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const ids = resolvePlan().map((p) => p.slot.id);
    expect(ids).toContain('email');
    expect(ids).toContain('storage');
    expect(ids).toContain('concierge');
    expect(ids).not.toContain('imagery');            // tooling stays out until asked for
    expect(resolvePlan({ all: true }).map((p) => p.slot.id)).toContain('imagery');
  });

  it('follows the chosen provider, not the recommendation', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const plan = resolvePlan({ choices: { storage: 'b2' } });
    expect(plan.find((p) => p.slot.id === 'storage')?.option.id).toBe('b2');
  });

  it('drops a slot entirely when the choice is to do without', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const ids = resolvePlan({ choices: { travel: 'deep-link', rides: 'manual-codes' } }).map((p) => p.slot.id);
    expect(ids).not.toContain('travel');
    expect(ids).not.toContain('rides');
  });

  it('stops asking once the chosen option already has its keys', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const ids = resolvePlan({ alreadySet: new Set(['RESEND_API_KEY']) }).map((p) => p.slot.id);
    expect(ids).not.toContain('email');
  });
});

describe('the ladder only names rungs that exist', () => {
  /** Every (slot, option, recipe) the registry's browser rungs point at. */
  function browserRungs(): { where: string; secrets: string[]; recipe: string }[] {
    const out: { where: string; secrets: string[]; recipe: string }[] = [];
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        for (const step of option.ladder) {
          if (step.method !== 'browser' || !('recipe' in step) || typeof step.recipe !== 'string') continue;
          out.push({ where: `${slot.id}/${option.id}`, secrets: option.secrets, recipe: step.recipe });
        }
      }
    }
    return out;
  }

  it('has a browser recipe for every recipe the registry references', async () => {
    const { RECIPES } = await import('../../scripts/secrets/browser-capture.mjs');
    const rungs = browserRungs();
    expect(rungs.length, 'no browser rungs found — the invariant would be vacuous').toBeGreaterThan(0);
    for (const { where, recipe } of rungs) {
      expect(RECIPES[recipe as keyof typeof RECIPES], `${where} points at a missing recipe "${recipe}"`).toBeDefined();
    }
  });

  it('captures only variables the option actually asks for', async () => {
    const { RECIPES } = await import('../../scripts/secrets/browser-capture.mjs');
    for (const { where, secrets, recipe } of browserRungs()) {
      const captures = RECIPES[recipe as keyof typeof RECIPES]?.captures ?? [];
      expect(captures.length, `${recipe} captures nothing`).toBeGreaterThan(0);
      for (const c of captures) {
        expect(secrets, `${where}'s recipe writes ${c.var}, which that option does not ask for`).toContain(c.var);
      }
    }
  });
});

describe('what a ceremony promises, the ladder can deliver', () => {
  it('never advertises "one link" without a rung that can produce one', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        if (ceremonyOf(option) !== 'link') continue;
        const delegated = option.ladder.some((s: { method: string }) => s.method === 'oauth' || s.method === 'device');
        expect(delegated, `${slot.id}/${option.id} promises a link with no oauth or device rung`).toBe(true);
      }
    }
  });

  it('never advertises "automatic" unless a rung needs no human at all', () => {
    // `harness` borrows a session this machine already holds — no human, no new account.
    const handsFree = new Set(['generate', 'derive', 'detect', 'harness', 'mcp', 'authmd', 'register']);
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        if (ceremonyOf(option) !== 'agent') continue;
        const free = option.ladder.some((s: { method: string }) => handsFree.has(s.method));
        expect(free, `${slot.id}/${option.id} claims automatic with no hands-free rung`).toBe(true);
      }
    }
  });

  it('carries the origin an oauth rung needs to discover its endpoints', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        for (const step of option.ladder as { method: string; origin?: string }[]) {
          if (step.method !== 'oauth') continue;
          expect(step.origin, `${slot.id}/${option.id} has an oauth rung with no origin to discover`).toMatch(/^https:\/\//);
        }
      }
    }
  });
});

describe('dynamic client registration asks only for what is on offer', () => {
  it('drops grants the server does not advertise', async () => {
    const { registerClient } = await import('../../scripts/secrets/oauth.mjs');
    let sent: Record<string, unknown> = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 201, text: async () => JSON.stringify({ client_id: 'abc' }) };
    }) as unknown as typeof fetch;
    try {
      // Requesting the device grant from a server that lacks it is what made Cloudflare and
      // Resend look unavailable: both answer 400 rather than ignoring the extra grant.
      await registerClient(
        { registration_endpoint: 'https://example.test/register', grant_types_supported: ['authorization_code', 'refresh_token'] },
        { redirectUri: 'https://claude.ai/code/artifact/x' },
      );
    } finally { globalThis.fetch = original; }
    expect(sent.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(sent.grant_types).not.toContain('urn:ietf:params:oauth:grant-type:device_code');
    // An https redirect is a web client, not a native one.
    expect(sent.application_type).toBeUndefined();
  });

  it('marks a loopback redirect as a native client', async () => {
    const { registerClient } = await import('../../scripts/secrets/oauth.mjs');
    let sent: Record<string, unknown> = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 201, text: async () => JSON.stringify({ client_id: 'abc' }) };
    }) as unknown as typeof fetch;
    try {
      await registerClient(
        { registration_endpoint: 'https://example.test/register', grant_types_supported: ['authorization_code'] },
        { redirectUri: 'http://127.0.0.1:8976/callback' },
      );
    } finally { globalThis.fetch = original; }
    expect(sent.application_type).toBe('native');
  });
});

/**
 * The local web app (`npm run secrets:serve`). It is the same page and the same envelope format as
 * the published artifact, so what needs proving is the part that differs: it acts on what it
 * receives, and it must not act on anything else. These cover the reachable surface without
 * binding a port — `serve.mjs` exports its pieces for exactly that.
 */
describe('the Secret Drop as a local web app', () => {
  it('runs a fixed set of commands, never a string from the request', () => {
    // The page posts a command *name*; the argv it maps to is written here, in the repo.
    for (const argv of Object.values(COMMANDS)) {
      expect(Array.isArray(argv)).toBe(true);
      expect(argv[0]).toMatch(/^scripts\/secrets\/[a-z-]+\.mjs$/);
    }
    expect(Object.keys(COMMANDS).sort()).toEqual(['acquire', 'autofill', 'verify']);
  });

  it('refuses a command it does not know, rather than shelling out', async () => {
    const result = await run('rm -rf /');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('unknown command');
  });

  it('will not write to a collection that is not part of the protocol', async () => {
    await expect(writeDoc('anything/else', 'set', { x: 1 })).rejects.toThrow(/not writable/);
    await expect(writeDoc('choices', 'set', { x: 1 })).rejects.toThrow(/collection and an id/);
  });

  it('will not apply an envelope whose name is not a variable name', async () => {
    // Otherwise a crafted name could reach `.env` as something other than an assignment.
    await expect(writeDoc('envelopes/not a name', 'set', { name: 'not a name' })).rejects.toThrow(/not a variable name/);
    await expect(writeDoc('envelopes/lowercase', 'set', { name: 'lowercase' })).rejects.toThrow(/not a variable name/);
  });

  it('projects the page\'s collections from files, and never a secret among them', async () => {
    const shown = await collections();
    // Exactly what the page subscribes to (template.html), plus the applied ledger it renders.
    for (const name of ['status', 'ceremonies', 'choices', 'handoffs', 'recipients', 'envelopes']) {
      expect(shown).toHaveProperty(name);
    }
    // The applied ledger is names, times and lengths — a value never survives the write to .env.
    // serve.mjs is plain ESM, so what comes back here is untyped — say what it is.
    for (const entry of Object.values(shown.envelopes) as Record<string, unknown>[]) {
      expect(Object.keys(entry).sort()).toEqual(['appliedAt', 'chars', 'name', 'where']);
    }
  });

  it('only ever reads and writes inside .secrets, and .env by name', () => {
    for (const [key, path] of Object.entries(FILES)) {
      expect(path.includes('/.secrets/'), `${key} -> ${path}`).toBe(true);
    }
  });
});
