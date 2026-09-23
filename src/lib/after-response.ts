import { after } from 'next/server';

/**
 * Runs `task` after the response has been sent, and keeps a serverless function alive until it
 * settles.
 *
 * A bare `void promise` is not that. On Vercel a function may be frozen the moment its response
 * is flushed, so un-awaited work — the one-time-code e-mail, sent in the background so a known
 * address answers no slower than an unknown one — can simply never finish, with nothing logged.
 * `after()` is Next's supported way to say "this belongs to the request, finish it". Outside a
 * request scope (unit and integration tests, scripts) it throws, and the task runs as before.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}
