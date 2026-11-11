import { describe, expect, it } from 'vitest';
import { createQueryGate, gatePostgresClient } from '@/db/query-gate';

/**
 * A stand-in for postgres-js with the properties that matter here: a query runs when it is awaited,
 * `.values()` only marks the result shape, `begin` hands the callback its own handle, and the
 * client counts how many queries it is running at once.
 */
interface FakeQuery extends PromiseLike<unknown> {
  values(): FakeQuery;
}
type FakeTx = { unsafe: (text: string) => FakeQuery };

function fakeClient(delayMs = 5) {
  const seen = { running: 0, peak: 0, sent: [] as string[], begun: 0 };
  const query = (text: string, fail = false): FakeQuery => {
    let values = false;
    let started: Promise<unknown> | undefined;
    const start = () =>
      (started ??= (async () => {
        seen.sent.push(text);
        seen.running += 1;
        seen.peak = Math.max(seen.peak, seen.running);
        await new Promise((r) => setTimeout(r, delayMs));
        seen.running -= 1;
        if (fail) throw new Error(`failed: ${text}`);
        return values ? [[text]] : [{ text }];
      })());
    const q: FakeQuery = {
      values() {
        values = true;
        return q;
      },
      then: (ok, bad) => start().then(ok, bad),
    };
    return q;
  };
  const client = Object.assign(() => 'tagged', {
    options: { parsers: {} as Record<string, unknown> },
    unsafe: (text: string) => query(text, text.startsWith('bad')),
    async begin(fn: (tx: FakeTx) => Promise<unknown>) {
      seen.begun += 1;
      return fn({ unsafe: (t: string) => query(`tx:${t}`) });
    },
    end: async () => 'ended',
  });
  return { client, seen };
}

describe('the query gate', () => {
  it('never lets more queries run at once than it has slots, and runs every one', async () => {
    const { client, seen } = fakeClient();
    const gated = gatePostgresClient(client, createQueryGate(3));
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => gated.unsafe(`q${i}`)));
    expect(seen.peak).toBe(3);
    expect(results).toHaveLength(40);
    expect(seen.sent).toHaveLength(40);
    // First come, first served: nothing overtakes a query that is already waiting.
    expect(seen.sent).toEqual(Array.from({ length: 40 }, (_, i) => `q${i}`));
  });

  it('without the gate the same load runs all at once (what made the client pipeline)', async () => {
    const { client, seen } = fakeClient();
    await Promise.all(Array.from({ length: 40 }, (_, i) => client.unsafe(`q${i}`)));
    expect(seen.peak).toBe(40);
  });

  it('sends nothing until the query is awaited, and passes .values() through', async () => {
    const { client, seen } = fakeClient();
    const gate = createQueryGate(2);
    const gated = gatePostgresClient(client, gate);
    const pending = gated.unsafe('later').values();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.sent).toEqual([]);
    expect(gate.active).toBe(0);
    expect(await pending).toEqual([['later']]);
    expect(await gated.unsafe('rows')).toEqual([{ text: 'rows' }]);
  });

  it('frees the slot when a query fails', async () => {
    const { client } = fakeClient();
    const gate = createQueryGate(1);
    const gated = gatePostgresClient(client, gate);
    await expect(gated.unsafe('bad one')).rejects.toThrow('failed: bad one');
    expect(gate.active).toBe(0);
    expect(await gated.unsafe('next')).toEqual([{ text: 'next' }]);
  });

  it('a transaction holds one slot while it is open; its own queries do not take another', async () => {
    const { client, seen } = fakeClient();
    const gate = createQueryGate(1);
    const gated = gatePostgresClient(client, gate);
    const inside: number[] = [];
    const result = await gated.begin(async (tx: FakeTx) => {
      inside.push(gate.active);
      await tx.unsafe('a');
      await tx.unsafe('b');
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(inside).toEqual([1]);
    expect(seen.sent).toEqual(['tx:a', 'tx:b']);
    expect(gate.active).toBe(0);
  });

  it('a query on the pool from inside a transaction does not wait for the slot that transaction holds', async () => {
    const { client, seen } = fakeClient();
    const gated = gatePostgresClient(client, createQueryGate(1));
    const done = gated.begin(async () => {
      await gated.unsafe('outside the transaction');
      return 'no deadlock';
    });
    const winner = await Promise.race([done, new Promise((r) => setTimeout(() => r('deadlock'), 500))]);
    expect(winner).toBe('no deadlock');
    expect(seen.sent).toEqual(['outside the transaction']);
  });

  it('waiting transactions and queries share the same slots', async () => {
    const { client, seen } = fakeClient();
    const gate = createQueryGate(2);
    const gated = gatePostgresClient(client, gate);
    let openTransactions = 0;
    let peakInFlight = 0;
    const note = () => (peakInFlight = Math.max(peakInFlight, openTransactions + seen.running));
    await Promise.all([
      ...Array.from({ length: 6 }, () =>
        gated.begin(async (tx: FakeTx) => {
          openTransactions += 1;
          note();
          await tx.unsafe('t');
          openTransactions -= 1;
        }),
      ),
      ...Array.from({ length: 12 }, (_, i) => gated.unsafe(`q${i}`).then(note)),
    ]);
    expect(seen.begun).toBe(6);
    expect(gate.active).toBe(0);
    // An open transaction's own query runs inside its slot, so the count can reach 2 + 2 here but
    // the connections in use (open transactions plus plain queries) never pass the two slots.
    expect(peakInFlight).toBeLessThanOrEqual(4);
  });

  it('leaves the rest of the client alone', async () => {
    const { client } = fakeClient();
    const gated = gatePostgresClient(client, createQueryGate(1));
    expect(gated.options).toBe(client.options);
    expect(await gated.end()).toBe('ended');
    expect((gated as unknown as () => string)()).toBe('tagged');
  });

  it('refuses a gate with no slots', () => {
    expect(() => createQueryGate(0)).toThrow();
  });
});
