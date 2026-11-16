'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import posthog from '@/lib/observe/posthog';
import { sessionProbe } from '@/themes/shared/session-hint';
import { startWebMcpBridge } from './register.client';

const IDENTIFIED_ACCOUNT_KEY = 'posthog_identified_account_id';

function readIdentifiedAccount(): string | null {
  try {
    return window.localStorage.getItem(IDENTIFIED_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function writeIdentifiedAccount(distinctId: string | null): void {
  try {
    if (distinctId) {
      window.localStorage.setItem(IDENTIFIED_ACCOUNT_KEY, distinctId);
    } else {
      window.localStorage.removeItem(IDENTIFIED_ACCOUNT_KEY);
    }
  } catch {
    // Analytics remains functional when browser storage is unavailable.
  }
}

/**
 * The WebMCP island. Renders nothing — no DOM, no styles, no layout shift — and in a browser
 * without `document.modelContext` it does nothing at all beyond mounting an empty effect.
 *
 * Mounted from the root layout behind the `WEBMCP` flag. The effect keys on `pathname`, so a
 * client-side navigation aborts the controller (which unregisters every tool through the
 * AbortSignal the spec defines) and starts a fresh bridge for the new page. That is also what
 * picks up a principal change: the manifest is refetched, and its fingerprint decides whether
 * anything actually needs re-registering.
 */
export function WebMcpBridge() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const bridge = startWebMcpBridge({
      signal: controller.signal,
      // `navigate_to` is a real navigation, not a description of one. The server has already
      // validated the path against the internal route allowlist before we get here.
      navigate: (route, highlight) => router.push(highlight ? `${route}#${highlight}` : route),
    });
    void bridge.refresh();
    return () => controller.abort();
  }, [pathname, router]);

  return null;
}

/** Identifies the authenticated account once per page load and clears it after a confirmed sign-out. */
export function PostHogIdentity() {
  useEffect(() => {
    let active = true;

    void sessionProbe().then(({ resolved, signedIn, distinctId }) => {
      if (!active || !resolved) return;

      const previousDistinctId = readIdentifiedAccount();
      if (!signedIn || !distinctId) {
        if (previousDistinctId) {
          posthog.reset();
          writeIdentifiedAccount(null);
        }
        return;
      }

      if (previousDistinctId && previousDistinctId !== distinctId) posthog.reset();
      posthog.identify(distinctId);
      writeIdentifiedAccount(distinctId);
    });

    return () => {
      active = false;
    };
  }, []);

  return null;
}

export default WebMcpBridge;
