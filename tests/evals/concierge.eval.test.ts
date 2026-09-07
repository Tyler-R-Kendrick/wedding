import { describe, expect, it } from 'vitest';
import { EVAL_CASES } from './cases';
import { formatReport, runEvalCase, summarise, type CaseReport } from './harness';
import { THRESHOLDS } from './thresholds';

/**
 * `npm run evals`. Runs the whole question set through the real pipeline with the deterministic mock
 * model and fails when any threshold in ./thresholds.ts is missed. Authorization violations must be
 * zero: a single one fails the build regardless of every other number.
 */
describe('concierge evals', () => {
  it(
    'meets the grounding, tool-selection, refusal and authorization thresholds',
    async () => {
      const reports: CaseReport[] = [];
      for (const evalCase of EVAL_CASES) reports.push(await runEvalCase(evalCase));
      const summary = summarise(reports);
      // Printed on pass and on failure: the numbers are the deliverable, not just the gate.
      console.log(formatReport(reports, summary));

      // Every case must pass against the deterministic mock, not just every threshold.
      //
      // The five metrics below have slack (0.9, 1.0, …) so a LIVE model's variance does not fail the
      // build. Against the mock there is no variance, and that slack was hiding whole broken cases:
      // a missing citation or an absent confirmation card moves none of the five, so the gate read
      // "100%" while two cases printed FAIL. A case that fails is either a wrong expectation or a
      // real defect; neither is something to average away.
      if (!process.env.EVALS_LIVE) {
        expect(summary.failures, `cases failed against the deterministic model:\n${JSON.stringify(summary.failures, null, 2)}`).toEqual([]);
      }

      expect(summary.authzViolations, `authorization violations: ${JSON.stringify(summary.failures, null, 2)}`).toBe(THRESHOLDS.authzViolations);
      expect(summary.unsupportedClaimRate, `unsupported claims: ${JSON.stringify(summary.failures, null, 2)}`).toBeLessThanOrEqual(THRESHOLDS.unsupportedClaimRate);
      expect(summary.refusalCorrectness, `refusal correctness: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.refusalCorrectness);
      expect(summary.toolSelectionAccuracy, `tool selection: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.toolSelectionAccuracy);
      expect(summary.groundedRate, `grounded rate: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.groundedRate);
    },
    180_000,
  );
});
