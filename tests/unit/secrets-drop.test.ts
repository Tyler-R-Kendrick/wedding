import { beforeAll, describe, expect, it } from 'vitest';
// The Secret Drop tooling is plain ESM under scripts/ so it can run in a bare sandbox
// (no build, no tsx) — the tests import it the same way the scripts do.
import { mergeEnv, parseDotenv, presentNames, quote } from '../../scripts/secrets/env-file.mjs';
import { AUTOFILL, CREDENTIALS, METHOD_RANK, NEED, clientRegistry, resolveLadderOrder, varIndex } from '../../scripts/secrets/registry.mjs';

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

describe('credential registry', () => {
  it('gives every credential at least one rung and a manual floor', () => {
    for (const cred of CREDENTIALS) {
      expect(cred.ladder.length, `${cred.id} has no ladder`).toBeGreaterThan(0);
      expect(cred.ladder.at(-1)?.method, `${cred.id} must end in a human fallback`).toBe('manual');
      expect(cred.vars.length, `${cred.id} fills no variables`).toBeGreaterThan(0);
      for (const v of cred.vars) expect(v, `${cred.id}: ${v}`).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/);
    }
  });

  it('orders each ladder from cheapest to most human', () => {
    for (const cred of CREDENTIALS) {
      const ranks = cred.ladder.map((s) => METHOD_RANK[s.method as keyof typeof METHOD_RANK]);
      expect(ranks, `${cred.id} ladder is out of order`).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('never asks a human for something the sandbox generates itself', () => {
    const generated = new Set(Object.keys(AUTOFILL));
    for (const cred of CREDENTIALS) {
      for (const v of cred.vars) expect(generated.has(v), `${v} is both auto-filled and asked for`).toBe(false);
    }
  });

  it('states its own need, so nobody has to be asked what the site is for', () => {
    for (const cred of CREDENTIALS) {
      expect(Object.keys(NEED), `${cred.id} has need "${cred.need}"`).toContain(cred.need);
    }
  });

  it('groups alternates so one member satisfies the group', () => {
    const groups = new Map<string, string[]>();
    for (const cred of CREDENTIALS) {
      if (!cred.alternateOf) continue;
      groups.set(cred.alternateOf, [...(groups.get(cred.alternateOf) ?? []), cred.id]);
    }
    expect([...groups.keys()].sort()).toEqual(['embeddings', 'travel']);
    for (const [group, members] of groups) expect(members.length, `${group} is not a choice`).toBeGreaterThan(1);
  });

  it('marks a variable as paste-only exactly when no rung can obtain it', () => {
    for (const cred of CREDENTIALS) {
      const automatable = cred.ladder.some((s) => s.method !== 'manual');
      expect(cred.input === 'apply', `${cred.id}`).toBe(!automatable);
    }
  });

  it('exports a client registry the page can render without functions', () => {
    const client = clientRegistry();
    expect(JSON.parse(JSON.stringify(client))).toEqual(client);
    expect(client.credentials).toHaveLength(CREDENTIALS.length);
    for (const cred of client.credentials) {
      for (const step of cred.ladder) expect(client.methodLabels[step.method as keyof typeof client.methodLabels]).toBeDefined();
    }
  });

  it('indexes every registry variable exactly once', () => {
    const index = varIndex();
    const all = [...Object.keys(AUTOFILL), ...CREDENTIALS.flatMap((c) => c.vars)];
    expect(index.size).toBe(new Set(all).size);
    expect(index.get('RESEND_API_KEY')?.credential).toBe('resend');
    expect(index.get('CRON_SECRET')?.method).toBe('generate');
  });

  it('sorts a ladder by how little it asks of a person', () => {
    expect(resolveLadderOrder(['manual', 'device', 'generate'])).toEqual(['generate', 'device', 'manual']);
  });
});

describe('planning without asking', () => {
  it('plans the whole required set with no arguments at all', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const ids = resolvePlan().map((p) => p.cred.id);
    expect(ids).toContain('resend');
    expect(ids).toContain('storage');
    expect(ids).toContain('anthropic');
    // Tooling stays out of the default plan; --all opts into it.
    expect(ids).not.toContain('fal');
    expect(resolvePlan({ all: true }).map((p) => p.cred.id)).toContain('fal');
  });

  it('asks for only one member of an alternate group', () => {
    const plan = resolvePlanSync();
    const embeddings = plan.filter((id) => id === 'openai' || id === 'voyage');
    const travel = plan.filter((id) => ['duffel', 'skyscanner', 'booking'].includes(id));
    expect(embeddings).toHaveLength(1);
    expect(travel).toHaveLength(1);
  });

  it('stops asking for a group once one member is already set', async () => {
    const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
    const withVoyage = resolvePlan({ alreadySet: new Set(['VOYAGE_API_KEY']) }).map((p) => p.cred.id);
    expect(withVoyage).not.toContain('openai');
    expect(withVoyage).not.toContain('voyage');
  });
});

/** The default plan's credential ids, resolved eagerly for the synchronous assertions above. */
function resolvePlanSync(): string[] {
  return planIds;
}
let planIds: string[] = [];
beforeAll(async () => {
  const { resolvePlan } = await import('../../scripts/secrets/acquire.mjs');
  planIds = resolvePlan().map((p) => p.cred.id);
});

describe('what the page is told to offer', () => {
  it('keeps offering the sign-in rung when it only failed for want of a session', async () => {
    const { nextActionFor } = await import('../../scripts/secrets/acquire.mjs');
    const resend = CREDENTIALS.find((c) => c.id === 'resend')!;
    const action = nextActionFor(resend, {
      attempts: [
        { method: 'authmd', outcome: 'declines agentic registration' },
        { method: 'browser', outcome: 'no signed-in session for resend.com', code: 'NEEDS_HANDOFF' },
      ],
    });
    // "No session yet" is an invitation to sign in, never a reason to demand a paste.
    expect(action.method).toBe('browser');
    expect(action.reason).toMatch(/sign in once/i);
  });

  it('falls through to the human rung only once every automatic one is genuinely spent', async () => {
    const { nextActionFor } = await import('../../scripts/secrets/acquire.mjs');
    const anthropic = CREDENTIALS.find((c) => c.id === 'anthropic')!;
    expect(nextActionFor(anthropic, {
      attempts: [
        { method: 'authmd', outcome: 'no agent_auth metadata' },
        { method: 'browser', outcome: 'the saved session has expired', code: 'NEEDS_HANDOFF' },
      ],
    }).method).toBe('browser');
    expect(nextActionFor(anthropic, {
      attempts: [
        { method: 'authmd', outcome: 'no agent_auth metadata' },
        { method: 'browser', outcome: 'signed in, but no value matching the key format appeared' },
      ],
    }).method).toBe('manual');
  });

  it('starts at the top of the ladder before anything has been tried', async () => {
    const { nextActionFor } = await import('../../scripts/secrets/acquire.mjs');
    for (const cred of CREDENTIALS) {
      expect(nextActionFor(cred, undefined).method, cred.id).toBe(cred.ladder[0].method);
    }
  });
});

describe('the ladder only names rungs that exist', () => {
  it('has a browser recipe for every recipe the registry references', async () => {
    const { RECIPES } = await import('../../scripts/secrets/browser-capture.mjs');
    for (const cred of CREDENTIALS) {
      for (const step of cred.ladder) {
        if (step.method !== 'browser') continue;
        expect(RECIPES[step.recipe], `${cred.id} points at a missing recipe "${step.recipe}"`).toBeDefined();
      }
    }
  });

  it('points each recipe at a variable its credential actually fills', async () => {
    const { RECIPES } = await import('../../scripts/secrets/browser-capture.mjs');
    for (const cred of CREDENTIALS) {
      for (const step of cred.ladder) {
        if (step.method !== 'browser') continue;
        const target = RECIPES[step.recipe]?.target;
        expect(cred.vars, `${cred.id}'s recipe writes ${target}, which it does not own`).toContain(target);
      }
    }
  });
});
