'use client';

import { useEffect } from 'react';
import { checkLocal, ensureLocal, getLocalModels } from '@/lib/ai/local';
import { keepLocalModels } from '@/lib/ai/local/keeper';

/**
 * Looks for the on-device models and installs what is missing (src/lib/ai/local/keeper.ts has the
 * rules). Signed-in guests' pages mount it, through GuestModelKeeper; nobody else downloads them.
 * Renders nothing, and waits until the browser is idle, so it never competes with the page the
 * guest came for.
 */
export function LocalModelKeeper() {
  useEffect(() => {
    const controller = new AbortController();
    const start = () => void keepLocalModels({ check: checkLocal, ensureLocal, getStatus: getLocalModels }, controller.signal);
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    let handle: number | ReturnType<typeof setTimeout>;
    let cancel: () => void;
    if (idle) {
      handle = idle(start, { timeout: 5_000 });
      cancel = () => (globalThis as unknown as { cancelIdleCallback(h: number): void }).cancelIdleCallback(handle as number);
    } else {
      handle = setTimeout(start, 2_000);
      cancel = () => clearTimeout(handle);
    }
    return () => {
      cancel();
      controller.abort();
    };
  }, []);
  return null;
}
