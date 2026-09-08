/**
 * How the page checks launch a browser, in one place.
 *
 * Three copies of `executablePath: '/opt/pw-browsers/chromium'` said the same wrong thing: that
 * path is *this sandbox's* pre-installed Chromium, and on a CI runner — where `npx playwright
 * install` puts its own build in Playwright's cache — it does not exist. The first of these checks
 * to run in CI failed on its first attempt with `Failed to launch chromium because executable
 * doesn't exist`, having passed locally every time, because local is the environment where the
 * path happens to be real.
 *
 * `playwright.config.ts` already had this right; this is the same rule, shared so the checks
 * cannot drift from it or from each other: take the system Chromium only if it is actually there
 * (and then `--no-sandbox`, since it runs as root here), otherwise let Playwright find its own.
 */
import { existsSync } from 'node:fs';

const SYSTEM = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

export function launchOptions() {
  return existsSync(SYSTEM) ? { executablePath: SYSTEM, args: ['--no-sandbox'] } : {};
}
