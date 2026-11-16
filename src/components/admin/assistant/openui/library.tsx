'use client';

import '@/components/trip/openui/no-devtools';
import { createLibrary, Renderer, type ActionEvent } from '@openuidev/react-lang';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { adminComponents, safeHref } from './components';
import { functions } from './functions';
import { toolProvider, useAssistantHost } from './host';

/**
 * The console's OpenUI library: the Intelligent UI dashboard vocabulary (components and @functions),
 * plus `Proposal`. The composer in src/domain/admin-assistant/compose.ts writes programs against
 * exactly these names and arguments, and `tests/unit/admin-assistant` parses every program it can
 * write against this library's schema.
 */
export const adminLibrary = createLibrary({
  root: 'Col',
  components: adminComponents,
  functions,
});

/**
 * One answer. Its `Query(...)` statements run through the capability route, its links stay inside
 * the console, and a follow-up button hands its question back to the conversation.
 */
type RendererProps = Parameters<typeof Renderer>[0];

export function AdminRenderer({ response, onAsk, onError, onStateUpdate }: { response: string | null; onAsk?: (message: string) => void; onError?: RendererProps['onError']; onStateUpdate?: RendererProps['onStateUpdate'] }) {
  const router = useRouter();
  const host = useAssistantHost();
  const tools = useMemo(() => toolProvider(host), [host]);
  const handle = useCallback(
    (event: ActionEvent) => {
      const params = (event.params ?? {}) as Record<string, unknown>;
      if (event.type === 'open_url') {
        const target = safeHref(params.url);
        if (!target) return;
        if (target.internal) router.push(target.href);
        else window.open(target.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (event.type === 'continue_conversation') {
        const message = typeof params.message === 'string' && params.message.trim() ? params.message : event.humanFriendlyMessage;
        if (message && onAsk) onAsk(String(message).trim());
      }
    },
    [router, onAsk],
  );
  return <Renderer response={response} library={adminLibrary} isStreaming={false} onAction={handle as never} onError={onError} onStateUpdate={onStateUpdate} toolProvider={tools as never} />;
}
