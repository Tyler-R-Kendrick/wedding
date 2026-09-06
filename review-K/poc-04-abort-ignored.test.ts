/**
 * FINDING 4 — the bridge ignores the AbortSignal WebMCP hands every tool execution, so "stop"
 * does not stop a mutation, and a tool unregistered mid-flight still completes server-side.
 *
 * src/webmcp/execute.ts:72   `async function execute(input)` — the callback's second parameter
 *                            (`ToolExecuteCallbackOptions { signal }`) is never accepted.
 * src/webmcp/execute.ts:35   `ExecuteDeps.post(name, body)` has nowhere to put a signal.
 * src/webmcp/register.client.ts:84-89  the POST is issued with no `signal`.
 *
 * The spec (src/webmcp/dom.ts:36-41, transcribed from the WebMCP draft) defines
 * `callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options)`
 * and the signal is aborted when the agent cancels the call or the tool is unregistered. A guest
 * who tells their agent to stop mid-RSVP still gets the RSVP written, and is told it succeeded.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-04-abort-ignored.test.ts
 */
import { describe, expect, it } from 'vitest';
import { createExecute, type BridgeResponse } from '@/webmcp/execute';
import type { WebMcpToolDescriptor } from '@/webmcp/descriptors';

const tool: WebMcpToolDescriptor = {
  name: 'webmcp_test_action',
  title: 'Test: save a value',
  description: 'Saves a value.',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  kind: 'action',
  execution: { auth: 'guest', idempotent: true, confirmation: 'inline', stepUp: false, maxOutputChars: 500 },
};

describe('FINDING 4: the agent cancelling a tool call does not cancel the mutation', () => {
  it('never accepts the options object the user agent passes, so there is no signal to honour', () => {
    const execute = createExecute(tool, { post: async () => ({ status: 200, body: { ok: true } }), principalKind: 'guest' });
    expect(
      execute.length,
      'the execute callback must accept (inputObject, { signal }) — it declares only the input',
    ).toBe(2);
  });

  it('resolves a cancelled consequential call as a completed mutation', async () => {
    const controller = new AbortController();
    let abortedWhileInFlight = false;

    const post = (): Promise<BridgeResponse> =>
      new Promise((resolve) =>
        setTimeout(() => {
          abortedWhileInFlight = controller.signal.aborted;
          resolve({ status: 200, body: { ok: true, data: { saved: true, value: 'v' } } });
        }, 30),
      );

    const execute = createExecute(tool, { post, principalKind: 'guest' });
    // Exactly how a user agent invokes it: (inputObject, { signal }).
    const running = (execute as (i: Record<string, unknown>, o: { signal: AbortSignal }) => Promise<unknown>)(
      { value: 'v' },
      { signal: controller.signal },
    );

    await new Promise((r) => setTimeout(r, 5));
    controller.abort(); // the guest hits "stop"
    const result = JSON.parse(String(await running));

    // The request was still outstanding when the guest cancelled ...
    expect(abortedWhileInFlight).toBe(true);
    // ... and the bridge went on to report success anyway.
    expect(
      result,
      'a call the guest cancelled must not come back as ok:true with the mutation applied',
    ).not.toMatchObject({ ok: true, data: { saved: true } });
  });
});
