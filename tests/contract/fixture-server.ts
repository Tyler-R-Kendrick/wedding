import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A real HTTP fixture server for adapter contract tests. Each test installs a handler; the
 * server records every hit (method, path, headers, body) so tests can assert on the request
 * shape, and `close()` destroys hung responses so timeout tests never leak sockets.
 */
export interface FixtureRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
export type FixtureHandler = (req: FixtureRequest, res: http.ServerResponse) => void | Promise<void>;

export interface FixtureServer {
  baseUrl: string;
  hits: FixtureRequest[];
  set(handler: FixtureHandler): void;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  let handler: FixtureHandler = (_req, res) => {
    res.statusCode = 404;
    res.end();
  };
  const hits: FixtureRequest[] = [];
  const pending = new Set<http.ServerResponse>();
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const r: FixtureRequest = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body };
    hits.push(r);
    pending.add(res);
    res.on('close', () => pending.delete(res));
    await handler(r, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits,
    set: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of pending) res.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** Never answers: the adapter's AbortSignal.timeout must fire. */
export const hang: FixtureHandler = () => undefined;

/** Fixture `fetch` bound to a base URL so adapters can be pointed at the server without touching globals. */
export const localFetch: typeof fetch = (input, init) => fetch(input, init);
