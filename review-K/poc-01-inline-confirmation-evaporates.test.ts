/**
 * FINDING 1 — `confirmation: 'inline'` is silently dropped on the `webmcp` surface, so a model
 * completes a mutation whose descriptor says a human confirms it.
 *
 * src/webmcp/server/invoke.ts:15-20  (effectiveWebMcpDescriptor upgrades only transaction/external)
 * src/capabilities/invoke.ts:123     (`if (descriptor.confirmation === 'explicit')` — `inline` is never enforced)
 *
 * On the `ui` surface `inline` is honoured by the page: it renders a confirm step, and a human is
 * present by construction. On `webmcp` there is no page and no human, and the pipeline does
 * nothing at all for `inline`, so the tool just runs. `webmcp_test_action` is exactly this shape
 * (kind: 'action', confirmation: 'inline', auth: 'guest') and it is listed in the guest manifest.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-01-inline-confirmation-evaporates.test.ts
 */
import { describe, expect, it } from 'vitest';
import { as, invoke, jsonOf, key, manifest } from './helpers';

describe('FINDING 1: an inline-confirmation mutation runs unconfirmed on the agent surface', () => {
  it('is advertised to the agent as an ordinary consequential tool', async () => {
    const { body } = await jsonOf(await manifest(as('guest')));
    const tool = (body.data as { tools: { name: string; execution: Record<string, unknown>; description: string }[] }).tools.find(
      (t) => t.name === 'webmcp_test_action',
    );
    expect(tool, 'webmcp_test_action must be in the guest manifest').toBeTruthy();
    // FIXED (swarm K): the bridge now advertises the effective mode as `explicit`, because on a
    // surface with no page and no human an `inline` promise cannot be kept. This line read
    // `.toBe('inline')` when the review was written — recording the behaviour the finding is
    // about — and inverts by construction now that the finding is fixed. See findings.md
    // "Minimal fix": "widen requiresHumanConfirmation ... so the manifest advertises
    // execution.confirmation: 'explicit'".
    expect(tool!.execution.confirmation).toBe('explicit');
    // ... and the description now tells the model a human has to agree first.
    expect(
      tool!.description.toLowerCase(),
      'a mutation the descriptor wants confirmed should say so in the text the model reads',
    ).toContain('confirm');
  });

  it('executes the mutation with no human in the loop', async () => {
    const { status, body } = await jsonOf(
      await invoke('webmcp_test_action', { input: { value: 'agent-wrote-this' }, idempotencyKey: key() }, as('guest')),
    );

    // What actually happens today: 200 + the change applied, no confirmation step of any kind.
    // The assertion below is what a `confirmation: 'inline'` descriptor promises its author.
    expect(
      { status, code: (body.error as { code?: string } | undefined)?.code },
      'a capability whose descriptor asks for confirmation must not complete from an agent unasked',
    ).toEqual({ status: 409, code: 'confirmation_required' });

    // Recorded the vulnerable behaviour when the review was written
    // (`toEqual({ saved: true, value: 'agent-wrote-this' })`); now the mutation must not have run
    // at all, so there is no data to return.
    expect(body.data, 'the mutation must not have been applied').toBeUndefined();
  });

  it('by contrast, the explicit-confirmation twin is refused — that is the behaviour inline should share', async () => {
    const { status, body } = await jsonOf(
      await invoke('webmcp_test_explicit', { input: { value: 'agent-wrote-this' }, idempotencyKey: key() }, as('guest')),
    );
    expect(status).toBe(409);
    expect(body.error).toMatchObject({ code: 'confirmation_required', details: { reason: 'requires_ui' } });
  });
});
