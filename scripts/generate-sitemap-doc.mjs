#!/usr/bin/env node
/**
 * Writes docs/sitemap.md from the site inventory.
 * `inventoryMarkdown()` is the source; this shells out so the renderer can import the TS module.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', path.join(root, 'scripts/render-sitemap-md.ts')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
