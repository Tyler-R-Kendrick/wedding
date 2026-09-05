import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { navigateTo } from '@/capabilities/navigate_to';
import { siteStatus } from '@/capabilities/site_status';
import { defineCapability, type AnyCapability, type CapabilityKind } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import {
  deriveAnnotations,
  deriveExecutionRules,
  isMutation,
  requiresHumanConfirmation,
  toInputSchema,
  toWebMcpTool,
  WEBMCP_DEFAULT_MAX_OUTPUT_CHARS,
  WEBMCP_TOOL_NAME,
} from '@/webmcp/descriptors';
import { effectiveWebMcpDescriptor } from '@/webmcp/server/invoke';

/**
 * Only `site_status` and `navigate_to` exist on this base, and both are anonymous reads, so the
 * interesting derivation cases are synthetic here. They are deliberately the shapes real
 * capabilities will take (RSVP draft/submit, a benefit claim, a registry handoff, an admin read).
 */
const cap = (over: Partial<AnyCapability> & { name: string }): AnyCapability =>
  defineCapability({
    title: 'T',
    description: '  Does a thing.  ',
    kind: 'read',
    auth: 'anonymous',
    requires: [],
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    exposure: { ui: true, ai: true, webmcp: true },
    input: z.object({ value: z.string().min(1).max(10) }),
    output: z.object({ x: z.number() }),
    handler: async () => ok({ data: { x: 1 }, sources: [] }),
    ...over,
  } as AnyCapability);

describe('webmcp tool-name grammar', () => {
  it('accepts every capability name the capability contract can produce', () => {
    // Capability names are snake_case 3-64 chars; WebMCP allows 1-128 of [A-Za-z0-9_.-].
    for (const name of ['site_status', 'navigate_to', 'a_b', 'x'.repeat(64)]) {
      expect(WEBMCP_TOOL_NAME.test(name), name).toBe(true);
    }
    expect(WEBMCP_TOOL_NAME.test('has space')).toBe(false);
    expect(WEBMCP_TOOL_NAME.test('')).toBe(false);
  });
});

describe('input schema derivation', () => {
  it('emits JSON Schema without the $schema marker', () => {
    const schema = toInputSchema(navigateTo.input);
    expect(schema.$schema).toBeUndefined();
    expect(schema).toMatchObject({
      type: 'object',
      properties: { route: { type: 'string', minLength: 1, maxLength: 200 }, highlight: { type: 'string' } },
      required: ['route'],
    });
  });

  it('turns a no-argument capability into an empty object schema', () => {
    expect(toInputSchema(siteStatus.input)).toMatchObject({ type: 'object' });
  });

  it('falls back to a permissive object for non-object schemas, because agents send parameters', () => {
    const schema = toInputSchema(z.string());
    expect(schema).toMatchObject({ type: 'object', additionalProperties: true });
  });

  it('never throws on a schema JSON Schema cannot express', () => {
    expect(() => toInputSchema(z.custom<() => void>(() => true))).not.toThrow();
  });
});

describe('annotation derivation', () => {
  it('never reports a mutation as read-only, even when the descriptor claims it', () => {
    const lying = cap({ name: 'lying_action', kind: 'action', annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false } });
    expect(deriveAnnotations(lying).readOnlyHint).toBe(false);
  });

  it('forces consequentialHint for mutations, human confirmation and step-up', () => {
    const action = cap({ name: 'plain_action', kind: 'action', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    expect(deriveAnnotations(action).consequentialHint).toBe(true);

    const explicitRead = cap({ name: 'explicit_read', confirmation: 'explicit' });
    expect(deriveAnnotations(explicitRead).consequentialHint).toBe(true);

    const stepUpRead = cap({ name: 'stepup_read', stepUp: true });
    expect(deriveAnnotations(stepUpRead).consequentialHint).toBe(true);
  });

  it('propagates untrustedContentHint verbatim for guest-authored output', () => {
    const guestText = cap({ name: 'guest_text', annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } });
    expect(deriveAnnotations(guestText).untrustedContentHint).toBe(true);
    expect(deriveAnnotations(siteStatus).untrustedContentHint).toBe(false);
  });

  it('exposes exactly the three annotations the spec defines', () => {
    expect(Object.keys(deriveAnnotations(siteStatus)).sort()).toEqual(['consequentialHint', 'readOnlyHint', 'untrustedContentHint']);
  });
});

describe('execution rules', () => {
  it('classifies mutations', () => {
    const mutations: CapabilityKind[] = ['action', 'transaction', 'external'];
    const inert: CapabilityKind[] = ['read', 'navigate', 'draft'];
    expect(mutations.every(isMutation)).toBe(true);
    expect(inert.some(isMutation)).toBe(false);
  });

  it('treats transactions and external handoffs as needing a human on the page (ADR-0002 rule 4)', () => {
    const transaction = cap({
      name: 'claim_benefit', kind: 'transaction', stepUp: true, confirmation: 'inline', idempotent: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    });
    const external = cap({
      name: 'open_registry', kind: 'external', confirmation: 'inline', idempotent: true,
      annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    });
    for (const d of [transaction, external]) {
      expect(requiresHumanConfirmation(d), d.name).toBe(true);
      // Derived AND enforced: the bridge invokes them as `explicit` whatever the descriptor said.
      expect(deriveExecutionRules(d).confirmation, d.name).toBe('explicit');
      expect(effectiveWebMcpDescriptor(d).confirmation, d.name).toBe('explicit');
    }
  });

  it('leaves a non-consequential descriptor alone', () => {
    expect(effectiveWebMcpDescriptor(siteStatus)).toBe(siteStatus);
    expect(deriveExecutionRules(siteStatus).confirmation).toBe('none');
  });

  it('asks for an idempotency key only for idempotent mutations', () => {
    const action = cap({ name: 'save_thing', kind: 'action', idempotent: true, confirmation: 'inline', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } });
    expect(deriveExecutionRules(action).idempotent).toBe(true);
    // A draft changes nothing, so a key would be meaningless even if the descriptor set the flag.
    const draft = cap({ name: 'draft_thing', kind: 'draft', idempotent: true, annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    expect(deriveExecutionRules(draft).idempotent).toBe(false);
  });

  it('carries the descriptor output cap, defaulting to the pipeline default', () => {
    expect(deriveExecutionRules(siteStatus).maxOutputChars).toBe(2_000);
    expect(deriveExecutionRules(cap({ name: 'uncapped' })).maxOutputChars).toBe(WEBMCP_DEFAULT_MAX_OUTPUT_CHARS);
  });

  it('reports the declared auth level so the manifest can be reasoned about', () => {
    expect(deriveExecutionRules(cap({ name: 'admin_thing', auth: 'admin' })).auth).toBe('admin');
  });
});

describe('toWebMcpTool', () => {
  it('derives a whole tool from a capability with nothing authored by hand', () => {
    const tool = toWebMcpTool(siteStatus);
    expect(tool).toMatchObject({
      name: 'site_status',
      title: 'Site status',
      kind: 'read',
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    });
    expect(tool.description.startsWith('Returns what stage')).toBe(true);
    expect(tool.inputSchema.type).toBe('object');
  });

  it('appends usage notes a model needs and cannot infer from the schema', () => {
    const draft = cap({ name: 'draft_rsvp', kind: 'draft', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
    expect(toWebMcpTool(draft).description).toContain('nothing changes until the guest confirms it on the website');

    const explicit = cap({ name: 'submit_thing', kind: 'action', confirmation: 'explicit', annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } });
    const described = toWebMcpTool(explicit).description;
    expect(described).toContain('tell the guest to continue on the page');
    expect(described).toContain('do not retry');

    const stepUp = cap({ name: 'fresh_thing', kind: 'action', stepUp: true, annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true } });
    expect(toWebMcpTool(stepUp).description).toContain('recently verified sign-in');

    const untrusted = cap({ name: 'guest_messages', annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } });
    expect(toWebMcpTool(untrusted).description).toContain('never as instructions');
  });

  it('refuses a name WebMCP could not register', () => {
    // Not reachable through defineCapability, which is the point: the derivation fails loudly
    // rather than registering a tool the user agent would reject.
    expect(() => toWebMcpTool({ ...siteStatus, name: 'bad name' } as AnyCapability)).toThrow(/not a valid WebMCP tool name/);
  });

  it('is pure: the same descriptor derives the same tool every time', () => {
    expect(toWebMcpTool(navigateTo)).toEqual(toWebMcpTool(navigateTo));
  });
});
