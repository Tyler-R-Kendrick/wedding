import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createQueryGate, gatePostgresClient } from '@/db/query-gate';

/**
 * The query gate against the real client and a real server. The rest of the suite runs on PGlite,
 * which has no pool and no postgres-js, and that is how a setting that broke every pooled
 * transaction once passed every test and stopped a production deploy.
 *
 * Runs only when REAL_POSTGRES_URL names a server to use (any empty database will do):
 *
 *   REAL_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run tests/integration/db-real-postgres.test.ts
 */
const url = process.env.REAL_POSTGRES_URL;
const POOL = 3;

/** A client that reports each query it writes onto a connection that is still answering another. */
function watchedClient(options: Record<string, unknown> = {}) {
  const connectionOf = new Map<string, number>();
  const busy = new Map<number, number>();
  let pipelined = 0;
  const client = postgres(url!, {
    max: POOL,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
    debug: (connection: number, query: string) => {
      if (!query.includes('/*watch:')) return;
      connectionOf.set(query, connection);
      const now = (busy.get(connection) ?? 0) + 1;
      busy.set(connection, now);
      if (now > 1) pipelined += 1;
    },
    ...options,
  });
  const finished = (query: string) => {
    const connection = connectionOf.get(query);
    if (connection !== undefined) busy.set(connection, (busy.get(connection) ?? 1) - 1);
  };
  const slow = (i: number) => `select pg_sleep(0.02), ${i} as n /*watch:${i}*/`;
  return { client, slow, finished, pipelined: () => pipelined, connections: () => busy.size };
}

describe.skipIf(!url)('the query gate on a real server', () => {
  const clients: { end: (o?: { timeout: number }) => Promise<void> }[] = [];
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end({ timeout: 2 })));
  });

  it('without the gate, postgres-js writes queries onto busy connections once the pool is full', async () => {
    const w = watchedClient();
    clients.push(w.client);
    await Promise.all(Array.from({ length: 30 }, (_, i) => w.client.unsafe(w.slow(i)).then(() => w.finished(w.slow(i)))));
    expect(w.connections()).toBe(POOL);
    expect(w.pipelined()).toBeGreaterThan(0);
  });

  it('with the gate, every query has a connection to itself', async () => {
    const w = watchedClient();
    clients.push(w.client);
    const gated = gatePostgresClient(w.client, createQueryGate(POOL));
    const rows = await Promise.all(Array.from({ length: 60 }, (_, i) => gated.unsafe(w.slow(i)).then((r) => (w.finished(w.slow(i)), r))));
    expect(rows).toHaveLength(60);
    expect((rows[7] as unknown as { n: number }[])[0]!.n).toBe(7);
    expect(w.connections()).toBeLessThanOrEqual(POOL);
    expect(w.pipelined()).toBe(0);
  });

  it('max_pipeline: 0 is not a way to do this: it breaks every transaction', async () => {
    // Not in the client's published option types; it reads it all the same (postgres/src/index.js).
    const client = postgres(url!, { max: POOL, prepare: false, onnotice: () => {}, ...({ max_pipeline: 0 } as object) });
    clients.push(client);
    await expect(client.begin((tx) => tx`select 1`)).rejects.toThrow(/UNSAFE_TRANSACTION/);
  });

  it('transactions commit, roll back and return rows through the gate, as the ORM drives them', async () => {
    const w = watchedClient();
    clients.push(w.client);
    const gate = createQueryGate(POOL);
    const db = drizzle({ client: gatePostgresClient(w.client, gate) });
    await db.execute(sql`create table if not exists gate_probe (id int primary key, note text)`);
    await db.execute(sql`truncate gate_probe`);

    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into gate_probe values (1, 'kept')`);
      // A savepoint inside the transaction, as drizzle nests them.
      await tx.transaction(async (inner) => {
        await inner.execute(sql`insert into gate_probe values (2, 'kept too')`);
      });
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into gate_probe values (3, 'undone')`);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    const rows = await db.execute(sql`select id from gate_probe order by id`);
    expect(Array.from(rows as Iterable<{ id: number }>).map((r) => r.id)).toEqual([1, 2]);
    expect(gate.active).toBe(0);
  });

  it('many transactions and queries at once all finish, on no more connections than the pool has', async () => {
    const w = watchedClient();
    clients.push(w.client);
    const gate = createQueryGate(POOL);
    const gated = gatePostgresClient(w.client, gate);
    const db = drizzle({ client: gated });
    await db.execute(sql`create table if not exists gate_counter (id int primary key, n int not null)`);
    await db.execute(sql`insert into gate_counter values (1, 0) on conflict (id) do update set n = 0`);

    await Promise.all([
      // The rate limiter's shape: lock one row, read it, write it.
      ...Array.from({ length: 25 }, () =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select n from gate_counter where id = 1 for update`);
          await tx.execute(sql`update gate_counter set n = n + 1 where id = 1`);
        }),
      ),
      ...Array.from({ length: 80 }, (_, i) => gated.unsafe(w.slow(i)).then(() => w.finished(w.slow(i)))),
    ]);

    const [{ n }] = Array.from((await db.execute(sql`select n from gate_counter where id = 1`)) as Iterable<{ n: number }>) as [{ n: number }];
    expect(n).toBe(25);
    expect(w.pipelined()).toBe(0);
    expect(gate.active).toBe(0);
    expect(gate.waiting).toBe(0);
  });
});
