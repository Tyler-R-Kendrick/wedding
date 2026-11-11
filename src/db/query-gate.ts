import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Never more work in flight than there are pooled connections.
 *
 * postgres-js gives a query an idle connection if there is one, opens another while it is under
 * `max`, and otherwise writes the query onto a connection that is still answering an earlier one
 * (pipelining). A database answers those in order. The deployed site talks to a transaction-mode
 * pooler, which hands each query to whichever backend is free, and the answers came back crossed
 * (a row decoded against another query's columns) or never (every page of a build waiting past its
 * minute). postgres-js has a switch for pipelining, `max_pipeline`, but at 0 it also stops
 * reserving a connection for a transaction, so every `sql.begin` fails: that was tried, and it
 * stopped a production deploy at its migrations.
 *
 * So the limit is kept one layer up. A gate with as many slots as the pool has connections sits in
 * front of the client: a query takes a slot for as long as it runs, a transaction for as long as
 * it is open, and the eleventh waits here, in this process, for one to finish. With at most `max`
 * in flight every query finds a connection of its own, and the client never pipelines. A slot is
 * free again exactly when its connection is: postgres-js resolves a query in the same step that
 * marks the connection idle.
 */
export interface QueryGate {
  run<T>(work: () => PromiseLike<T>): Promise<T>;
  /** Held slots and callers waiting for one: for tests and logs. */
  readonly active: number;
  readonly waiting: number;
}

export function createQueryGate(slots: number): QueryGate {
  if (!Number.isInteger(slots) || slots < 1) throw new Error(`a query gate needs at least one slot, got ${slots}`);
  let active = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    const next = queue.shift();
    // Hand the slot straight to the next in line, so a newcomer cannot overtake it.
    if (next) next();
    else active -= 1;
  };
  return {
    async run(work) {
      if (active < slots) active += 1;
      else await new Promise<void>((resolve) => queue.push(resolve));
      try {
        return await work();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}

/** The part of a postgres-js client the ORM calls (drizzle-orm/postgres-js/session.js). */
interface PostgresLike {
  unsafe(query: string, params?: unknown[], options?: unknown): PromiseLike<unknown> & { values(): PromiseLike<unknown> };
  begin(...args: unknown[]): Promise<unknown>;
}

/**
 * Set while a gated transaction is open. A query sent on the pool from inside one (not on the
 * transaction itself) goes straight through: it would otherwise wait for a slot its own
 * transaction is holding, and ten such transactions at once would wait for each other for ever.
 */
const insideTransaction = new AsyncLocalStorage<true>();

/**
 * The same client, with `unsafe` and `begin` taking a slot first. Everything else (`options`,
 * `end`, the tagged-template call) is the client's own. Queries inside a transaction run on the
 * transaction's own handle, which postgres-js passes to the callback and this never wraps: they
 * share the transaction's one connection and its one slot, and the pooler keeps a transaction on
 * one backend.
 */
export function gatePostgresClient<T extends object>(client: T, gate: QueryGate): T {
  const real = client as unknown as PostgresLike;
  const unsafe = (query: string, params?: unknown[], options?: unknown) => {
    // postgres-js runs a query when it is awaited, not when it is made, and `.values()` only marks
    // how rows are returned. The same here: nothing is sent, and no slot is taken, until `then`.
    let asValues = false;
    let started: Promise<unknown> | undefined;
    const start = () =>
      (started ??= (() => {
        const send = () => {
          const pending = real.unsafe(query, params, options);
          return asValues ? pending.values() : pending;
        };
        return insideTransaction.getStore() ? Promise.resolve(send()) : gate.run(send);
      })());
    const lazy = {
      values() {
        asValues = true;
        return lazy;
      },
      then<A = unknown, B = never>(onOk?: ((value: unknown) => A | PromiseLike<A>) | null, onError?: ((reason: unknown) => B | PromiseLike<B>) | null) {
        return start().then(onOk, onError);
      },
      catch<B = never>(onError?: ((reason: unknown) => B | PromiseLike<B>) | null) {
        return start().catch(onError);
      },
      finally(onDone?: (() => void) | null) {
        return start().finally(onDone);
      },
    };
    return lazy;
  };
  const begin = (...args: unknown[]) => {
    const open = () => insideTransaction.run(true, () => real.begin(...args));
    // A transaction opened inside another gated one is a second connection: let it through as well.
    return insideTransaction.getStore() ? open() : gate.run(open);
  };
  return new Proxy(client, {
    get(target, property) {
      if (property === 'unsafe') return unsafe;
      if (property === 'begin') return begin;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
