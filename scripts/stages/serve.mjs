#!/usr/bin/env node
/**
 * Serves a stage's static export the way a static host does:
 *
 *   node scripts/stages/serve.mjs <out dir> <port>     # what `npm run start -w @wedding/<stage>` runs
 *
 * `/rsvp` and `/rsvp/` both answer from `rsvp/index.html` (the export uses trailing slashes), and an
 * unknown path gets the stage's own 404 page. Loopback only; this is for looking, not hosting.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const [dirArg = 'out', portArg = '3100'] = process.argv.slice(2);
const root = path.resolve(dirArg);
const port = Number(portArg);
if (!existsSync(root)) {
  console.error(`serve: ${root} does not exist. Build the stage first (npm run build).`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};

/** The file a request path names, or null: malformed or escaping paths are simply not found. */
function resolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  const abs = path.join(root, path.normalize(decoded));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  for (const candidate of [abs, path.join(abs, 'index.html'), `${abs}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url ?? '/');
  const status = file ? 200 : 404;
  const body = file ?? path.join(root, '404.html');
  res.writeHead(status, { 'content-type': TYPES[path.extname(body)] ?? 'application/octet-stream' });
  createReadStream(body).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${path.relative(process.cwd(), root) || '.'} on http://localhost:${port}`));
