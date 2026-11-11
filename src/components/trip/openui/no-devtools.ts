/**
 * OpenUI mounts its "Inspect" widget on every page in development, and fetches it from a CDN the
 * site's Content Security Policy rightly refuses: the dev and test servers then log a blocked
 * script on Your Trip, which the crawler counts as a page error. The package skips the mount when
 * this flag is already set (`@openuidev/react-lang`, devtoolsBootstrap), so it is set before that
 * package is first evaluated: this module is imported ahead of it. Production builds never mount it.
 */
(globalThis as Record<symbol, unknown>)[Symbol.for('openui.devtools.autoMount')] = true;

export {};
