'use client';

import { useEffect } from 'react';
import { recordHandoff } from './client';

/**
 * Progressive enhancement: links rendered by ExternalHandoffCard carry data-record-*
 * attributes; when JS is available a click also records the handoff through the
 * capability layer. Without JS the link still opens the provider.
 */
export function HandoffClickRecorder() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[data-record-capability]') as HTMLAnchorElement | null;
      if (!a) return;
      const capability = a.dataset.recordCapability;
      if (!capability || !/^[a-z][a-z0-9_]{2,63}$/.test(capability)) return;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(a.dataset.recordInput ?? '{}') as Record<string, unknown>;
      } catch {
        return;
      }
      recordHandoff(capability, input);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
