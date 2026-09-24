/**
 * Static file lookup shared by serve.mjs (one stage) and gateway.mjs (the dev host), done the
 * way a static host does it: `/rsvp` and `/rsvp/` both answer from `rsvp/index.html`.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};

/** The file under `root` a request path names, or null: malformed or escaping paths are simply not found. */
export function resolveFile(root, urlPath) {
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
