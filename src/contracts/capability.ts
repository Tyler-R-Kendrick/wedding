import type { ZodType } from 'zod';
import type { CapabilityError } from './errors';
import type { AuditSink } from './audit';
import type { FlagValues } from './flags';
import type { Entitlement, Principal } from './principal';
import type { Citation, Provenance, TrustClass } from './provenance';
import type { Result } from './result';
import type { IdempotencyKey } from './ids';

/**
 * A capability is the ONE way to do anything in this system. The web UI,
 * the embedded AI concierge, WebMCP tools, and admin screens all invoke
 * capabilities; none of them carry their own business logic or authorization.
 *
 * kind:
 *  - read        return data; execute freely when authorized
 *  - navigate    open a route / highlight something; execute freely
 *  - draft       prepare a mutation and return a proposal (no side effects)
 *  - action      persist a change (RSVP, preferences) — confirmation per `confirmation`
 *  - transaction claim a benefit / commit an external booking — confirmation + step-up
 *  - external    hand off to a provider (redirect/deep link); never takes payment
 */
export type CapabilityKind = 'read' | 'navigate' | 'draft' | 'action' | 'transaction' | 'external';
export type AuthLevel = 'anonymous' | 'guest' | 'admin' | 'system';
export type ConfirmationMode = 'none' | 'inline' | 'explicit';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
  consequentialHint: boolean;
}

export interface CapabilityExposure {
  ui: boolean;
  ai: boolean;
  webmcp: boolean;
}

export interface CapabilityContext {
  principal: Principal;
  requestId: string;
  now: Date;
  flags: FlagValues;
  audit: AuditSink;
  /** Trust class of the *caller's* input (e.g. an AI tool call fed by external content). */
  inputTrust: TrustClass;
  idempotencyKey?: IdempotencyKey;
  /** Signed confirmation token issued by a prior `draft`/preview step. */
  confirmationToken?: string;
  /** Current theme/lifecycle preview context, for navigate capabilities. */
  view?: { theme?: string; lifecycle?: string };
  /** Adapter registry and DB are provided by the app; typed loosely here to keep contracts dependency-free. */
  services: Record<string, unknown>;
}

export interface CapabilityOutcome<O> {
  data: O;
  /** Provenance for every fact in `data` that the AI may cite. */
  sources: Citation[];
  /** Present when a `draft` produced a proposal that needs `confirm`. */
  confirmation?: { token: string; expiresAt: string; summary: string };
  /** Present when the capability handed off externally. */
  handoffUrl?: string;
  /** Guest-visible provenance of live data, if any. */
  retrievedAt?: string;
}

export interface CapabilityDescriptor<I, O> {
  /** snake_case, stable, also the WebMCP/AI tool name. */
  name: string;
  title: string;
  /** Written for both humans and models: what it does, when to use it, what it will not do. */
  description: string;
  kind: CapabilityKind;
  auth: AuthLevel;
  requires: readonly Entitlement[];
  /** Fresh authentication required (money, identity, external commitments). */
  stepUp?: boolean;
  confirmation?: ConfirmationMode;
  /** Mutations must be idempotent: the same key replays the first result. */
  idempotent?: boolean;
  /** Feature flag that must be on. */
  flag?: keyof FlagValues;
  annotations: ToolAnnotations;
  exposure: CapabilityExposure;
  input: ZodType<I>;
  output: ZodType<O>;
  /** Max serialized output size for AI/WebMCP consumers (chars). */
  maxOutputChars?: number;
  handler: (ctx: CapabilityContext, input: I) => Promise<Result<CapabilityOutcome<O>, CapabilityError>>;
}

/** Helper preserving inference. */
export function defineCapability<I, O>(d: CapabilityDescriptor<I, O>): CapabilityDescriptor<I, O> {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(d.name)) throw new Error(`capability name must be snake_case: ${d.name}`);
  if (d.kind === 'read' || d.kind === 'navigate') {
    if (!d.annotations.readOnlyHint) throw new Error(`${d.name}: read/navigate capabilities must be readOnlyHint`);
  }
  if (d.kind === 'transaction' && !d.stepUp) throw new Error(`${d.name}: transactions require stepUp`);
  if ((d.kind === 'transaction' || d.kind === 'external') && !d.annotations.consequentialHint) {
    throw new Error(`${d.name}: transactions/external handoffs must be consequentialHint`);
  }
  return d;
}

export type AnyCapability = CapabilityDescriptor<any, any>;

/** Registry contract implemented in src/capabilities/registry.ts. */
export interface CapabilityRegistry {
  get(name: string): AnyCapability | undefined;
  list(filter?: { exposure?: keyof CapabilityExposure; principal?: Principal; flags?: FlagValues }): AnyCapability[];
}

/**
 * Invocation pipeline (src/capabilities/invoke.ts):
 *   1. resolve descriptor; check flag
 *   2. validate input (zod) — untrusted input never reaches handlers unvalidated
 *   3. authorize: auth level, entitlements, ownership (handlers re-check row ownership)
 *   4. step-up check when `stepUp`
 *   5. confirmation token check when `confirmation === 'explicit'`
 *   6. idempotency replay when `idempotent`
 *   7. handler
 *   8. validate output, cap size, attach sources
 *   9. audit (success/denied/failed) — always, including denials
 */
export type InvokeFn = <I, O>(descriptor: CapabilityDescriptor<I, O>, ctx: CapabilityContext, rawInput: unknown) => Promise<Result<CapabilityOutcome<O>, CapabilityError>>;

/** Provenance attached to outputs must be reduced to citations before leaving the server. */
export const toSources = (items: readonly Provenance[]): Citation[] =>
  items.map((p) => ({ sourceId: p.sourceId, title: p.title, url: p.canonicalUrl, verifiedAt: p.verifiedAt, recordRef: p.recordRef }));
