import { describe, expect, it } from 'vitest';
import { verdict } from '../../../scripts/ci/gate.mjs';

const job = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion });

/** The `CI` check (scripts/ci/gate.mjs) is the one required of a pull request: it must never pass on less than everything. */
describe('the CI gate passes only when every other job has passed', () => {
  it('waits while any job is queued or running, and when it has no list at all', () => {
    expect(verdict([]).state).toBe('wait');
    expect(verdict([job('a', 'completed', 'success'), job('b', 'in_progress')]).state).toBe('wait');
    expect(verdict([job('a', 'queued'), job('b', 'completed', 'skipped')]).state).toBe('wait');
  });

  it('passes on success and skipped, and on nothing else', () => {
    expect(verdict([job('a', 'completed', 'success'), job('b', 'completed', 'skipped')]).state).toBe('pass');
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'stale', null]) {
      const result = verdict([job('a', 'completed', 'success'), job('b', 'completed', conclusion)]);
      expect(result.state, String(conclusion)).toBe('fail');
      expect(result.bad.map((j: { name: string }) => j.name)).toEqual(['b']);
    }
  });

  it('fails as soon as one job has failed, without waiting for the rest', () => {
    expect(verdict([job('a', 'completed', 'failure'), job('b', 'in_progress')]).state).toBe('fail');
  });
});
