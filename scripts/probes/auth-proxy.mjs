/**
 * A header-injecting proxy so `impeccable detect <url>` can see the SIGNED-IN guest tree.
 *
 * `impeccable detect` drives a browser at a URL and takes no `--header` or `--cookie` option, and
 * the canonical test principal (`src/domain/testing/testPrincipal.ts`) is honored only through the
 * `x-test-auth` / `x-test-principal` request headers. So the detector on its own can reach only the
 * signed-out view of `/rsvp`, `/your-weekend`, `/transportation` and `/trip` — the four routes an
 * independent review measured as unthemed. Those four are the ones that most need scanning, and
 * they were the ones the gate could not see.
 *
 * This forwards every request to the test server with the headers attached, so the detector scans
 * the page a claimed guest actually gets. It changes nothing about the app: same server, same
 * resolver, same `NODE_ENV=test` guard that already refuses these headers anywhere else.
 *
 *   node scripts/probes/auth-proxy.mjs 3317 A1        # then: impeccable detect http://localhost:3317/trip
 *   node scripts/probes/auth-proxy.mjs 3317 admin
 *
 * `PROBE_BASE` (default http://localhost:3316) picks the upstream. Requires a NODE_ENV=test server.
 */
import http from 'node:http';
import { PRINCIPALS, BASE } from './lib.mjs';

const port = Number(process.argv[2] ?? 3317);
const who = process.argv[3] ?? 'A1';
const principal = PRINCIPALS[who];
if (!principal) throw new Error(`unknown principal ${who}; expected one of ${Object.keys(PRINCIPALS).join(', ')}`);
const upstream = new URL(BASE);

const server = http.createServer((req, res) => {
  const headers = {
    ...req.headers,
    host: upstream.host,
    'x-test-auth': process.env.TEST_AUTH_SECRET ?? 'e2e-test-secret-0123456789',
    'x-test-principal': JSON.stringify(principal),
  };
  const proxied = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  proxied.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(String(err));
  });
  req.pipe(proxied);
});
server.listen(port, () => console.log(`auth-proxy ${who} :${port} -> ${BASE}`));
