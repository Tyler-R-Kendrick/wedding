import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The themes list is generated from src/themes/; make it before any test reads it, however vitest was started. */
export default function setup() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/sync-themes.mjs', import.meta.url))], { stdio: 'ignore' });
}
