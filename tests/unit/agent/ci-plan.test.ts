import { describe, expect, it } from 'vitest';
import { durationKey, grepFor, grepTitle, plan as planE2e } from '../../../scripts/ci/e2e-plan.mjs';
import { filesOf, plan as planFiles, readDurations } from '../../../scripts/ci/vitest-plan.mjs';

type E2eTest = { file: string; titles: string[]; project: string };

const t = (file: string, title: string, project = 'mobile'): E2eTest => ({ file, titles: [title], project });

describe('the Playwright shard plan (scripts/ci/e2e-plan.mjs)', () => {
  const tests = [t('tests/e2e/a.spec.ts', 'one'), t('tests/e2e/a.spec.ts', 'one', 'desktop'), t('tests/e2e/a.spec.ts', 'two'), t('tests/e2e/b.spec.ts', 'three'), t('tests/e2e/b.spec.ts', 'four'), t('tests/e2e/c.spec.ts', 'five'), t('tests/e2e/c.spec.ts', 'six'), t('tests/e2e/c.spec.ts', 'seven')];
  const seconds = { [durationKey(tests[0]!)]: 60, [durationKey(tests[1]!)]: 60, [durationKey(tests[3]!)]: 100, [durationKey(tests[5]!)]: 10 };
  const keys = (list: E2eTest[]) => list.map(durationKey).sort();

  it('puts every test in exactly one shard, whatever the number of shards', () => {
    for (const n of [1, 2, 3, 5, 12]) {
      const shards = planE2e(tests, seconds, n, () => false);
      expect(shards).toHaveLength(n);
      expect(keys(shards.flatMap((s) => s.tests))).toEqual(keys(tests));
    }
  });

  it('fills by recorded time, not by count: the long tests do not share a shard', () => {
    const [one, two] = planE2e(tests, seconds, 2, () => false);
    const of = (test: E2eTest) => (keys(one!.tests).includes(durationKey(test)) ? 1 : 2);
    expect(of(tests[3]!)).not.toBe(of(tests[0]!));
    expect(Math.abs(one!.seconds - two!.seconds)).toBeLessThan(40);
  });

  it('keeps a serial file whole within a project, because its tests depend on the ones before them', () => {
    for (const shards of [planE2e(tests, seconds, 3, (file) => file.endsWith('c.spec.ts')), planE2e(tests, seconds, 8, (file) => file.endsWith('c.spec.ts'))]) {
      expect(shards.filter((s) => s.tests.some((x) => x.file.endsWith('c.spec.ts')))).toHaveLength(1);
    }
  });

  it('counts a test with no recorded time as the median, so a new test cannot make a shard look empty', () => {
    const [only] = planE2e(tests, seconds, 1, () => false);
    // Recorded: 60, 60, 100, 10 (median 60). Four tests have none.
    expect(only!.seconds).toBe(60 + 60 + 100 + 10 + 4 * 60);
  });

  it('gives the same shards for the same inputs', () => {
    expect(planE2e(tests, seconds, 3, () => false)).toEqual(planE2e([...tests].reverse(), seconds, 3, () => false));
  });

  it('names a shard by exact titles: a test whose title only starts or ends the same is not selected', () => {
    const grep = new RegExp(grepFor([t('tests/e2e/a.spec.ts', 'opens (the) page?')]));
    expect(grep.test('mobile e2e/a.spec.ts opens (the) page?')).toBe(true);
    expect(grep.test('mobile e2e/a.spec.ts opens (the) page? twice')).toBe(false);
    expect(grep.test('desktop e2e/a.spec.ts opens (the) page?')).toBe(false);
    expect(grep.test('mobile e2e/a.spec.ts opens the page')).toBe(false);
    // A tagged test is still its own title.
    expect(grep.test('mobile e2e/a.spec.ts opens (the) page? @slow')).toBe(true);
    expect(grepTitle(t('tests/security/x.spec.ts', 'y', 'desktop'))).toBe('desktop security/x.spec.ts y');
  });
});

describe('the integration shard plan (scripts/ci/vitest-plan.mjs)', () => {
  it('puts every integration test file in exactly one shard', () => {
    const files = filesOf('integration');
    expect(files.length).toBeGreaterThan(50);
    for (const n of [1, 4, 7]) {
      const planned = planFiles(files, readDurations('integration'), n).flatMap((s) => s.files);
      expect(planned.sort()).toEqual(files);
    }
  });

  it('balances recorded time', () => {
    const shards = planFiles(['a', 'b', 'c', 'd', 'e'], { a: 50, b: 30, c: 20, d: 20, e: 20 }, 2, 0);
    expect(shards.map((s) => s.seconds).sort()).toEqual([70, 70]);
  });
});
