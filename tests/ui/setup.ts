import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount every rendered tree between tests.
 *
 * Testing Library registers this itself only when Vitest runs with `globals: true`, and this
 * project does not, so without this file a `render()` that is never explicitly unmounted leaves a
 * live React root behind. React 19 keeps scheduler work queued for a live root, and that callback
 * can fire after Vitest has torn the jsdom environment down — surfacing as an uncaught
 * `ReferenceError: window is not defined` that fails the run *after* every test has passed.
 *
 * Measured on this suite: 0 failures in 12 unloaded runs, 2 in 8 runs under CPU contention, each
 * with exactly one error per un-unmounted root. Registering cleanup here rather than in one spec
 * covers the UI tests later levels add, which will not know to unmount by hand.
 */
afterEach(cleanup);
