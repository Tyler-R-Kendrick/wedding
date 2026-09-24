#!/usr/bin/env node
/**
 * Serves a stage's static export the way a static host does:
 *
 *   node scripts/stages/serve.mjs <out dir> <port>     # what `npm run start -w @wedding/<stage>` runs
 *
 * `/rsvp` and `/rsvp/` both answer from `rsvp/index.html` (the export uses trailing slashes), and an
 * unknown path gets the stage's own 404 page. Loopback only; this is for looking, not hosting.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { TYPES, resolveFile } from './files.mjs';

const [dirArg = 'out', portArg = '3100'] = process.argv.slice(2);
const root = path.resolve(dirArg);
const port = Number(portArg);
if (!existsSync(root)) {
  console.error(`serve: ${root} does not exist. Build the stage first (npm run build).`);
  process.exit(1);
}

createServer((req, res) => {
  const file = resolveFile(root, req.url ?? '/');
  const status = file ? 200 : 404;
  const body = file ?? path.join(root, '404.html');
  res.writeHead(status, { 'content-type': TYPES[path.extname(body)] ?? 'application/octet-stream' });
  createReadStream(body).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving ${path.relative(process.cwd(), root) || '.'} on http://localhost:${port}`));
