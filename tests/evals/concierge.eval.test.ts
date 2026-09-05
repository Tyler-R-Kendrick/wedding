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

      expect(summary.authzViolations, `authorization violations: ${JSON.stringify(summary.failures, null, 2)}`).toBe(THRESHOLDS.authzViolations);
      expect(summary.unsupportedClaimRate, `unsupported claims: ${JSON.stringify(summary.failures, null, 2)}`).toBeLessThanOrEqual(THRESHOLDS.unsupportedClaimRate);
      expect(summary.refusalCorrectness, `refusal correctness: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.refusalCorrectness);
      expect(summary.toolSelectionAccuracy, `tool selection: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.toolSelectionAccuracy);
      expect(summary.groundedRate, `grounded rate: ${JSON.stringify(summary.failures, null, 2)}`).toBeGreaterThanOrEqual(THRESHOLDS.groundedRate);
    },
    180_000,
  );
});
