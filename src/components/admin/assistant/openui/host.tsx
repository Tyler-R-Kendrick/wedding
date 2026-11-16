'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import { PROPOSABLE, READ_TOOLS } from '@/domain/admin-assistant/catalog';
import { shapeTool, toolArgs } from '@/domain/admin-assistant/shape';

/**
 * What a rendered answer may reach: the capability route, and nothing else. Every tool a program
 * queries and every change it proposes is a capability by name, checked here against the two short
 * lists the assistant is allowed to use and then, as always, authorized by the pipeline on the
 * server for the administrator who is signed in.
 */
export type AssistantHost = {
  call: (capability: string, body: { input?: unknown; idempotencyKey?: string; confirmationToken?: string }) => Promise<CapabilityResponse>;
  mayPropose: (capability: string) => boolean;
  newKey: () => string;
  /** Called after a change lands, so the page can refresh what it shows. */
  changed: () => void;
};

const proposable = new Set<string>(PROPOSABLE);

export const defaultHost: AssistantHost = {
  call: (capability, body) => callCapability(capability, body),
  mayPropose: (capability) => proposable.has(capability),
  newKey: newIdempotencyKey,
  changed: () => undefined,
};

const HostContext = createContext<AssistantHost>(defaultHost);

export function AssistantHostProvider({ host, children }: { host: AssistantHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export const useAssistantHost = () => useContext(HostContext);

/**
 * The tools a program's `Query(...)` may call: one function per read capability on the list, each a
 * POST to the capability route. A refusal throws, which the renderer reports through `onError` and
 * the answer keeps the data it was composed with.
 */
export function toolProvider(host: AssistantHost): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  return Object.fromEntries(
    READ_TOOLS.map((name) => [
      name,
      async (args: Record<string, unknown>) => {
        const res = await host.call(name, { input: toolArgs(args) });
        if (!res.ok) throw new Error(res.error?.message ?? 'That could not be loaded.');
        // The same reduction the server applied to the data the answer was composed with.
        return shapeTool(name, res.data);
      },
    ]),
  );
}
