import { describe, expect, it } from 'vitest';
// The Secret Drop tooling is plain ESM under scripts/ so it can run in a bare sandbox
// (no build, no tsx) — the tests import it the same way the scripts do.
import { mergeEnv, parseDotenv, presentNames, quote } from '../../scripts/secrets/env-file.mjs';
import { AUTOFILL, CEREMONY, METHOD_CEREMONY, METHOD_RANK, NEED, SLOTS, allVars, ceremonyOf, chosenOption, clientRegistry, recommendedOf } from '../../scripts/secrets/registry.mjs';

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

  it('ends every ladder in a human fallback, ordered cheapest rung first', () => {
    for (const slot of SLOTS) {
      for (const option of slot.options) {
        expect(option.ladder.length, `${option.id} has no ladder`).toBeGreaterThan(0);
        const ranks = option.ladder.map((step: { method: string }) => METHOD_RANK[step.method as keyof typeof METHOD_RANK]);
        expect(ranks, `${option.id} ladder is out of order`).toEqual([...ranks].sort((a, b) => a - b));
        const last = option.ladder.at(-1)?.method;
        expect(option.isOptOut ? ['derive', 'generate'] : ['manual'], `${option.id} ends at ${last}`).toContain(last);
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
