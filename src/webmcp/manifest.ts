import type { CapabilityRegistry } from '@/contracts/capability';
import type { FlagValues } from '@/contracts/flags';
import type { Principal } from '@/contracts/principal';
import { stableHash } from '@/lib/crypto';
import { toWebMcpTool, type WebMcpToolDescriptor } from './descriptors';

/** The spec revision this implementation was written against. Re-verify when bumping. */
export const WEBMCP_SPEC = {
  name: 'WebMCP',
  url: 'https://webmachinelearning.github.io/webmcp/',
  status: 'Draft Community Group Report',
  date: '2026-09-04',
} as const;

export const WEBMCP_MANIFEST_VERSION = 1;

export interface WebMcpManifest {
  version: typeof WEBMCP_MANIFEST_VERSION;
  spec: typeof WEBMCP_SPEC;
  /** Who the tools were derived for. Tool omission is UX minimisation; `invoke` re-authorizes every call. */
  principal: { kind: Principal['kind'] };
  /** Changes whenever the tool set or the principal kind changes; the client re-registers on change. */
  fingerprint: string;
  tools: WebMcpToolDescriptor[];
  generatedAt: string;
}

export interface BuildManifestInput {
  registry: Pick<CapabilityRegistry, 'list'>;
  principal: Principal;
  flags: FlagValues;
  now?: Date;
}

/**
 * The authorized tool list for one principal: every registered capability with
 * `exposure.webmcp`, whose flag is on, and that `authorize()` allows for this principal
 * (the registry applies all three). Anonymous callers therefore see only anonymous-auth tools.
 */
export function buildManifest(input: BuildManifestInput): WebMcpManifest {
  const tools = input.flags.WEBMCP
    ? input.registry.list({ exposure: 'webmcp', principal: input.principal, flags: input.flags }).map(toWebMcpTool)
    : [];
  return {
    version: WEBMCP_MANIFEST_VERSION,
    spec: WEBMCP_SPEC,
    principal: { kind: input.principal.kind },
    fingerprint: manifestFingerprint(input.principal.kind, tools),
    tools,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function manifestFingerprint(kind: Principal['kind'], tools: readonly WebMcpToolDescriptor[]): string {
  return stableHash({ kind, tools: tools.map((t) => ({ name: t.name, annotations: t.annotations, execution: t.execution, inputSchema: t.inputSchema })) }).slice(0, 32);
}
