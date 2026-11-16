#!/usr/bin/env node
/**
 * The `CI` job: one check that says whether every other job of this run passed.
 *
 * It starts with the other jobs and watches them, where a job that `needs` them would start only
 * once the last had finished: getting a runner at that point cost about 11 s on top of every run
 * (run 43904092781: the slowest job ended at 118 s and the run at 130).
 *
 * It fails closed. It passes only when it has seen every other job of the run completed, each
 * with `success` or `skipped`. A failed or cancelled job, a request that keeps failing, a job
 * list that is still changing, or running out of time all fail it.
 */
const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN } = process.env;
/** This job's own name in the workflow, so it does not wait for itself. */
const SELF = process.env.GATE_JOB_NAME ?? 'CI';
/** Every job of a run exists within a few seconds of its start; do not conclude before this. */
const SETTLE_MS = 20_000;
const POLL_MS = 2_000;
const DEADLINE_MS = Number(process.env.GATE_DEADLINE_MS ?? 8 * 60_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jobs() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?filter=latest&per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`listing the run's jobs answered ${res.status}`);
    const batch = (await res.json()).jobs;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((j) => j.name !== SELF);
}

/**
 * What the gate concludes from a job list: `wait` while anything is unfinished, else `pass` or
 * `fail` with the jobs that did not succeed.
 * @param {{ name: string, status: string, conclusion: string | null }[]} others
 */
export function verdict(others) {
  if (!others.length) return { state: 'wait', bad: [] };
  if (others.some((j) => j.status !== 'completed')) {
    // A job that has already failed fails the gate now; there is nothing to wait for.
    const bad = others.filter((j) => j.status === 'completed' && !['success', 'skipped'].includes(j.conclusion ?? ''));
    return bad.length ? { state: 'fail', bad } : { state: 'wait', bad: [] };
  }
  const bad = others.filter((j) => !['success', 'skipped'].includes(j.conclusion ?? ''));
  return { state: bad.length ? 'fail' : 'pass', bad };
}

async function main() {
  const started = Date.now();
  let failures = 0;
  let seen = -1;
  for (;;) {
    if (Date.now() - started > DEADLINE_MS) {
      console.error(`::error::the other jobs had not finished after ${Math.round(DEADLINE_MS / 60_000)} minutes`);
      return 1;
    }
    let others;
    try {
      others = await jobs();
      failures = 0;
    } catch (error) {
      if (++failures >= 5) {
        console.error(`::error::${error instanceof Error ? error.message : error}, five times in a row`);
        return 1;
      }
      await sleep(POLL_MS);
      continue;
    }
    const { state, bad } = verdict(others);
    if (state === 'fail') {
      for (const j of bad) console.error(`::error::${j.name}: ${j.conclusion}`);
      return 1;
    }
    // Pass only on a list that is past the settling time and the same size as the one before it.
    if (state === 'pass' && Date.now() - started >= SETTLE_MS && others.length === seen) {
      console.log(`all ${others.length} other jobs passed (${others.filter((j) => j.conclusion === 'skipped').length} skipped)`);
      return 0;
    }
    seen = others.length;
    await sleep(POLL_MS);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exitCode = await main();
