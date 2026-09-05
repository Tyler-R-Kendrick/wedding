'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { startWebMcpBridge } from './register.client';

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

export default WebMcpBridge;
