/**
 * Polls with a growing gap, and not at all while the page is hidden.
 *
 * `tick` runs at once, then after `first` ms, and each gap after that is `growth` times the last,
 * up to `max`. A hidden page skips its tick and schedules nothing; when it is shown again polling
 * restarts at `first`. `tick` is given `live()`, false once polling stopped or restarted, so a late
 * answer can be dropped. Only one chain runs at a time: a tick still in flight when the page is
 * shown again does not schedule a second chain when it returns. Returns a stop function.
 */
export function startBackoffPoll(tick: (live: () => boolean) => Promise<void>, opts: { first: number; growth: number; max: number; doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> }): () => void {
  const doc = opts.doc ?? document;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = opts.first;
  let chain = 0;
  const run = async (mine: number) => {
    timer = undefined;
    if (stopped || mine !== chain || doc.visibilityState === 'hidden') return;
    // `live` lets the tick drop a late answer after a stop or a restart; a tick that throws still
    // schedules the next one, rather than ending polling silently.
    const live = () => !stopped && mine === chain;
    try {
      await tick(live);
    } catch {
      /* the next poll asks again */
    }
    if (!live()) return;
    timer = setTimeout(() => void run(mine), delay);
    delay = Math.min(opts.max, Math.round(delay * opts.growth));
  };
  const onVisible = () => {
    if (stopped || doc.visibilityState !== 'visible') return;
    if (timer) clearTimeout(timer);
    delay = opts.first;
    void run(++chain);
  };
  doc.addEventListener('visibilitychange', onVisible);
  void run(chain);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}
