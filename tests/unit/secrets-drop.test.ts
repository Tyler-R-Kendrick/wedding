import { existsSync, readFileSync } from 'node:fs';
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
        // An option that asks for no secret — the on-device model, an opt-out, Higgsfield's MCP
        // authorization — has nothing to paste, so ending at a rung that asks nobody is correct.
        // Anything that asks for one must leave a way for a person to provide it.
        //
        // Derived from the ceremony each rung maps to rather than listed by hand: the list was
        // ['derive', 'generate', 'manual'], which was not the rule but an inventory of the
        // hands-free rungs that happened to be in use, so adding `mcp` "failed" an invariant it
        // actually satisfies.
        if (option.secrets.length) {
          expect(last, `${slot.id}/${option.id} wants ${option.secrets.length} secret(s) but ends at ${last}`).toBe('manual');
        } else {
          // Nothing to type, so it may stop at any rung that asks nobody — or still offer `manual`,
          // as borrowing a harness session does, where the last resort is a person doing it by hand
          // rather than a value they paste.
          const ceremonyId = METHOD_CEREMONY[last as keyof typeof METHOD_CEREMONY] as keyof typeof CEREMONY;
          const handsFree = CEREMONY[ceremonyId]?.asksYou === false;
          expect(handsFree || last === 'manual', `${slot.id}/${option.id} asks for nothing yet ends at ${last}`).toBe(true);
        }
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

/**
 * The page and its stores have to agree about which collections exist. They did not: `handoffs`
 * was written on every "Sign in once" and subscribed to by nobody, so the next snapshot rebuilt
 * the strip from state that had never heard of the request — restoring the button that had just
 * been pressed. Anyone acting on that page reasonably concluded it had not worked and pressed
 * again. These are the invariants that would have caught it.
 */
describe('the page and its stores agree on what exists', () => {
  const template = readFileSync(new URL('../../scripts/secrets/page/template.html', import.meta.url), 'utf8');
  const matchAll = (re: RegExp) => [...new Set([...template.matchAll(re)].map((m) => m[1]!))].sort();

  const written = matchAll(/db\.doc\('([a-z]+)\//g);
  const subscribed = matchAll(/db\.collection\('([a-z]+)'\)/g);

  it('reads back every collection it writes to', () => {
    // A write nobody reads is state the page cannot render, which reads to a user as "it failed".
    expect(written.length).toBeGreaterThan(0);
    for (const collection of written) expect(subscribed).toContain(collection);
  });

  it('is served every collection it subscribes to when it runs locally', async () => {
    const served = Object.keys(await collections());
    for (const collection of subscribed) expect(served).toContain(collection);
  });

  it('keeps its decisions in the module the tests can reach, not in the markup', () => {
    // Every choice the page makes now lives in scripts/secrets/page/logic.mjs, covered to 100% by
    // `npm run secrets:coverage`. What must stay true here is that the template *delegates*: the
    // moment a ceremony decision is inlined back into the HTML it leaves the covered path, which
    // is how a stale status came to override the selected provider unnoticed.
    expect(template).toContain('/*__LOGIC__*/');
    expect(template).toContain('createLogic(REG)');
    // No ceremony branching in the markup — that is logic.mjs's job.
    expect(template).not.toMatch(/REG\.ceremony\.(signin|link|apply|paste)\b/);
    expect(template).not.toMatch(/status\[slot\.id\]\?\.nextAction/);
  });
});

describe('a control that reports dispatched work dispatched work', () => {
  const template = readFileSync(new URL('../../scripts/secrets/page/template.html', import.meta.url), 'utf8');

  /**
   * The hand-off record the page writes, rebuilt from the template's own payload.
   *
   * Not a hand-written fixture: the previous audit checked the registry against the recipes and
   * passed while the path was broken, because the page sent `opt.host` and the relay wanted a
   * recipe id. What has to hold is that *the value the page actually sends* is dispatchable, so
   * the field mapping is read out of the markup and any change to it fails here.
   */
  function handoffPayload(): Record<string, string> {
    const match = template.match(/db\.doc\('handoffs\/'[^)]*\)\.set\(\{([\s\S]*?)\}\);/)?.[1];
    expect(match, 'the page no longer writes a handoffs/<slot> record the way this test reads it').toBeTruthy();
    const body = match!.replace(/\/\/[^\n]*/g, '');   // comments carry commas and colons of their own
    const fields: Record<string, string> = {};
    for (const [, key, value] of body.matchAll(/(?:^|,)\s*(\w+)\s*:\s*([^,\n]+)/gm)) fields[key!] = value!.trim();
    for (const bare of body.matchAll(/(?:^|,)\s*(\w+)\s*(?=,|$)/gm)) fields[bare[1]!] ??= bare[1]!;
    return fields;
  }

  it('sends the worker a target it can resolve, not the one a person would read', () => {
    const fields = handoffPayload();
    // `host` is the brand domain on the button; `recipe` is what browser-capture can look up.
    expect(fields.recipe, 'the page must send the recipe id — a host is a label, not a route').toContain('opt.recipe');
    expect(Object.keys(fields)).toContain('kind');
    expect(Object.keys(fields)).toContain('status');
  });

  it('turns every sign-in button into a job browser-capture can actually run', async () => {
    const { RECIPES } = await import('../../scripts/secrets/browser-capture.mjs');
    const { HANDOFF_WORK } = await import('../../scripts/secrets/serve.mjs');
    const resolves = (target: string) =>
      Boolean(RECIPES[target as keyof typeof RECIPES])
      || Object.values(RECIPES).some((r) => r.host === target);

    let offered = 0;
    for (const slot of clientRegistry().slots) {
      for (const option of slot.options) {
        if (option.ceremony !== 'signin') continue;
        offered += 1;
        // Exactly what `handoff()` writes, and exactly what the local server would pick up —
        // including the KIND, which is not always the one the ceremony implies. Higgsfield's
        // ceremony is a sign-in, but the thing that performs it is its own CLI login, not a
        // browser relay; assuming the kind here asserted that a relay could resolve `higgsfield.ai`,
        // which is true of nothing and was never what the page would send.
        const kind = (option.handoffKind || 'signin') as keyof typeof HANDOFF_WORK;
        const argv = HANDOFF_WORK[kind]({
          slot: slot.id, option: option.id, kind,
          recipe: option.recipe, host: option.host, cli: option.cli,
        });
        expect(argv, `${slot.id}/${option.id} offers a sign-in but dispatches nothing`).toBeTruthy();
        if (kind === 'signin') {
          expect(
            resolves(argv![2]!),
            `${slot.id}/${option.id} would dispatch "relay ${argv![2]}", which browser-capture cannot resolve`,
          ).toBe(true);
        } else {
          // Whatever else performs it must at least be a script that exists.
          expect(
            existsSync(new URL('../../' + argv![0], import.meta.url)),
            `${slot.id}/${option.id} dispatches ${argv!.join(' ')}, and ${argv![0]} is not there`,
          ).toBe(true);
        }
      }
    }
    expect(offered, 'no sign-in options found — the invariant would be vacuous').toBeGreaterThan(0);
  });

  it('turns every link button into a command acquire.mjs accepts', async () => {
    const { HANDOFF_WORK } = await import('../../scripts/secrets/serve.mjs');
    const acquire = readFileSync(new URL('../../scripts/secrets/acquire.mjs', import.meta.url), 'utf8');
    const linkSlots = clientRegistry().slots.filter((s) => s.options.some((o) => o.ceremony === 'link'));
    expect(linkSlots.length, 'no link options found — the invariant would be vacuous').toBeGreaterThan(0);
    for (const slot of linkSlots) {
      const argv = HANDOFF_WORK.link({ slot: slot.id, kind: 'link' });
      expect(argv?.[0]).toBe('scripts/secrets/acquire.mjs');
      // The subcommand and flag have to be ones the script really parses, not ones we wish it had.
      expect(acquire, `acquire.mjs has no "${argv![1]}" command`).toMatch(new RegExp(`case '${argv![1]}':`));
      expect(acquire, 'acquire.mjs does not read --slot').toContain("opt('slot'");
    }
  });

  it('has a worker for every kind of hand-off the page can ask for', async () => {
    const { HANDOFF_WORK } = await import('../../scripts/secrets/serve.mjs');
    const { createLogic } = await import('../../scripts/secrets/page/logic.mjs');
    const reg = clientRegistry();
    const L = createLogic(reg);
    // Derived from what actionFor really produces, not from a literal in the markup: the button's
    // kind became `action.handoffKind`, and a regex over the HTML would have quietly gone vacuous.
    const asked = new Set<string>();
    for (const slot of reg.slots) {
      for (const option of slot.options) {
        const action = L.actionFor(slot, { choices: { [slot.id]: option.id }, home: 'local' });
        if (action.kind === 'dispatch' && action.handoffKind) asked.add(action.handoffKind);
      }
    }
    expect(asked.size, 'no dispatchable option found — the invariant would be vacuous').toBeGreaterThan(0);
    for (const kind of asked) expect(Object.keys(HANDOFF_WORK), `nothing performs a "${kind}" hand-off`).toContain(kind);
  });

  it('never dispatches a kind nothing can perform, and never where nothing can record it', async () => {
    const { HANDOFF_WORK } = await import('../../scripts/secrets/serve.mjs');
    const { createLogic } = await import('../../scripts/secrets/page/logic.mjs');
    const reg = clientRegistry();
    const L = createLogic(reg);
    expect(template).toContain("db.local ? 'local' : 'artifact'");
    expect(template).toContain('home: homeOf()');

    // Behavioural rather than a regex over the markup. The previous version matched the button's
    // source within 400 characters of its branch, so adding a comment to that branch "failed" the
    // invariant while changing nothing — and, far worse, editing the button out entirely would
    // have failed it in exactly the same way as editing it wrongly. What actually matters is that
    // no press ever asks for work that nothing performs, or asks it where nothing can even write
    // the request down.
    let dispatches = 0;
    for (const home of ['local', 'artifact', 'disk'] as const) {
      for (const slot of reg.slots) {
        for (const option of slot.options) {
          const action = L.actionFor(slot, { choices: { [slot.id]: option.id }, home });
          if (action.kind !== 'dispatch') continue;
          dispatches += 1;
          expect(
            Object.keys(HANDOFF_WORK),
            `${home}: ${slot.id}/${option.id} asks for a "${action.handoffKind}" hand-off, which nothing performs`,
          ).toContain(action.handoffKind);
          // Off disk there is no store, so a request could not even be recorded.
          expect(home, `${home}: ${slot.id}/${option.id} dispatches with nowhere to record it`).not.toBe('disk');
        }
      }
    }
    expect(dispatches, 'nothing dispatches at all — the invariant would be vacuous').toBeGreaterThan(0);
  });
});

describe('nothing the page reports as pending is left with no one to finish it', () => {
  const template = readFileSync(new URL('../../scripts/secrets/page/template.html', import.meta.url), 'utf8');

  it('names a returned code the way the server recognises one', async () => {
    const { OAUTH_CODE_RE } = await import('../../scripts/secrets/serve.mjs');
    // Exactly the expression `takeCode()` uses, applied to every slot that could return a code.
    const mint = (slot: string) => `OAUTH_CODE_${slot}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 64);
    expect(template, 'the page no longer mints code names this way').toContain("('OAUTH_CODE_' + slot).toUpperCase()");
    for (const slot of SLOTS) {
      // A name the server does not recognise is written into .env as a variable and never
      // exchanged, which is what left the strip saying "finishing up" for ever.
      expect(OAUTH_CODE_RE.test(mint(slot.id)), `a code for ${slot.id} would be filed as "${mint(slot.id)}"`).toBe(true);
    }
  });

  it('no longer claims a pending thing is being handled without saying by what', () => {
    // Comments may still recount the history; what must not survive is a sentence the page shows.
    const shown = template.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // The two sentences that were true of nothing: both are gone, and both states now render
    // through renderWork(), which has to be told which of queued/running/failed is the case.
    expect(shown).not.toContain('Claude is on it');
    expect(shown).not.toContain('finishing up');
    expect(template).toContain('function renderWork(');
    const callers = [...template.matchAll(/renderWork\(/g)].length;
    expect(callers, 'renderWork is defined but nothing renders through it').toBeGreaterThan(2);
  });

  it('leaves no control that swallows the failure of its own write', () => {
    // A `.catch(() => {})` on a store write is indistinguishable, on screen, from the write
    // succeeding: the choice renders, the record never lands, and the page says nothing. Every
    // catch on a `db.doc(...)` chain must therefore take the error and do something with it.
    const blind: string[] = [];
    for (const m of template.matchAll(/db\.doc\(/g)) {
      const statement = template.slice(m.index!, m.index! + 400).split(';')[0]!;
      for (const c of statement.matchAll(/\.catch\(([^)]*)\)/g)) {
        if (!/^\(?\s*\w/.test(c[1]!)) blind.push(statement.split('\n')[0]!.trim());
      }
    }
    expect(blind, `${blind.length} store write(s) discard their own error`).toEqual([]);
  });
});

describe('the page checks launch a browser the way the repo already does', () => {
  it('uses the system Chromium only when it is really there', async () => {
    const { launchOptions } = await import('../../scripts/secrets/page/chromium.mjs');
    const opts = launchOptions() as { executablePath?: string; args?: string[] };
    if (existsSync(process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium')) {
      // Running as root against a system build, so it needs --no-sandbox — same as playwright.config.
      expect(opts.executablePath).toBeTruthy();
      expect(opts.args).toContain('--no-sandbox');
    } else {
      // A CI runner has no such path: passing one anyway is what failed this job's first run with
      // "Failed to launch chromium because executable doesn't exist". Let Playwright find its own.
      expect(opts).toEqual({});
    }
  });

  it('is the only place those checks decide it', () => {
    // Three copies of the same hardcoded path is how one of them stayed wrong.
    for (const file of ['verify-page.mjs', 'verify-lifecycle.mjs', 'verify-artifact.mjs']) {
      const src = readFileSync(new URL(`../../scripts/secrets/page/${file}`, import.meta.url), 'utf8');
      expect(src, `${file} still hardcodes a browser path`).not.toMatch(/executablePath:/);
      expect(src, `${file} does not share the launch rule`).toContain('launchOptions()');
    }
  });
});
