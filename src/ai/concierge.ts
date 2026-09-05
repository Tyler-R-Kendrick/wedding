import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type Tool } from 'ai';
import { invoke } from '@/capabilities/invoke';
import { registry as globalRegistry, type CapabilityRegistryImpl } from '@/capabilities/registry';
import type { AnyCapability, CapabilityContext, CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { aiAnswerSources, aiAnswers, capabilityInvocations, type AiAnswerStatus, type AiInvocationOutcome, type AiToolSelector, type AiVerifierSummary } from '@/db/schema/ai';
import { pipelineServices } from '@/capabilities/services';
import { citedSentences } from './citations';
import { aiConfig, type AiConfig } from './config';
import { CONTACT_LINK, REFUSAL, confirmationCardFor, labelForRoute, refusalLinks, systemPromptFor } from './contract';
import type { ConciergeEvent } from './events';
import { factsFromOutcome } from './facts';
import { scanForInjection } from './injection';
import { conciergeModels, type ConciergeModels } from './model';
import { redactForStorage } from './redact';
import { allAiTools, planRoute, toolsFor, type RoutePlan, type RouterTool } from './router';
import { appendTurns, enqueueAiPurge, loadOrCreateSession } from './session';
import { splitSentences, truncate } from './text';
import { citationToAnswerSource, renderContext, renderQuestion, renderSourceBlock, sortByTrust } from './trust';
import type { AnswerSource, ConciergeResult, ConfirmationCard, SpotlightedSource } from './types';
import { isRefusalSentinel, summarise, verifySentence, verifyWithModel, type VerifiedSentence } from './verifier';

/**
 * The concierge pipeline (ADR-0003). One question in, one verified answer out, streamed as events:
 *
 *   route (deterministic) → run tools through `invoke` (surface ai) → retrieve → classify trust and
 *   quarantine injections → generate (closed-world contract, evidence in the user turn) → verify
 *   every sentence → apply the protected-fact and live-data gates → cite → persist (redacted) →
 *   audit grounding failures and security alerts.
 *
 * Nothing the model writes reaches the guest before the verifier accepts it. The model formats;
 * it never recalls. Authorization happens inside `invoke` with the caller's principal only.
 */
export interface ConciergeInput {
  /** Built by the caller with `surface: 'ai'`; the concierge never widens or swaps the principal. */
  ctx: CapabilityContext;
  question: string;
  sessionId?: string;
  models?: ConciergeModels;
  emit?: (event: ConciergeEvent) => void | Promise<void>;
  registry?: CapabilityRegistryImpl;
  config?: Partial<AiConfig>;
}

export const MAX_STORED_ANSWER_CHARS = 2_000;
const SIGN_IN_ROUTE = '/your-weekend';
const DENIED_CODES = new Set(['unauthenticated', 'forbidden', 'step_up_required', 'feature_disabled', 'not_found', 'rate_limited', 'validation']);

interface ToolRun {
  name: string;
  descriptor: AnyCapability;
  outcome?: CapabilityOutcome<unknown>;
  error?: CapabilityError;
  selectedBy: AiToolSelector;
  durationMs: number;
}

export async function runConcierge(input: ConciergeInput): Promise<ConciergeResult> {
  const started = performance.now();
  const cfg: AiConfig = { ...aiConfig, ...input.config };
  const ctx: CapabilityContext = { ...input.ctx, surface: 'ai', inputTrust: 'UNTRUSTED_USER_CONTENT' };
  const reg = input.registry ?? globalRegistry;
  const services = pipelineServices(ctx);
  const db = ctx.services.db as Db;
  const emit = async (e: ConciergeEvent) => {
    await input.emit?.(e);
  };
  const question = truncate(input.question.replace(/\s+/g, ' ').trim(), cfg.AI_MAX_QUESTION_CHARS);
  const models = input.models ?? conciergeModels();
  const actor = toPrincipalRef(ctx.principal);
  const answerId = newId();

  const { session } = await loadOrCreateSession(db, { sessionId: input.sessionId, principal: ctx.principal, now: ctx.now, retentionDays: cfg.AI_SESSION_RETENTION_DAYS });
  await emit({ type: 'session', sessionId: session.id, answerId });

  // --- security: the guest's own message is data too; a jailbreak attempt is logged, never obeyed
  let securityAlerts = 0;
  const alert = async (kind: string, extra: Record<string, unknown>) => {
    securityAlerts++;
    await ctx.audit.record({ actor, action: 'ai.security_alert', target: { type: 'ai_answer', id: answerId }, outcome: 'denied', requestId: ctx.requestId, metadata: { kind, sessionId: session.id, ...extra } });
  };
  const userFindings = scanForInjection(question);
  if (userFindings.length) await alert('user_message', { rules: userFindings.map((f) => f.rule).join(',') });

  // --- route: derived from the registry, decided deterministically
  const available = toolsFor(ctx.principal, ctx.flags, reg);
  const everything = allAiTools(ctx.flags, reg);
  const plan = planRoute(question, available, everything, cfg.AI_MAX_TOOL_CALLS);
  await emit({ type: 'status', stage: 'routing', tools: plan.calls.map((c) => c.name) });

  const sources: SpotlightedSource[] = [];
  let markerCount = 0;
  const nextMarker = () => `S${++markerCount}`;
  const confirmations: ConfirmationCard[] = [];
  const toolsDenied = new Set<string>(plan.denied);
  const runs: ToolRun[] = [];

  const recordInvocation = async (run: ToolRun) => {
    let outcome: AiInvocationOutcome;
    if (run.outcome) outcome = 'success';
    else if (run.error?.code === 'confirmation_required') outcome = 'confirmation_required';
    else if (run.error && DENIED_CODES.has(run.error.code)) outcome = 'denied';
    else outcome = 'failed';
    await db.insert(capabilityInvocations).values({
      id: newId(),
      sessionId: session.id,
      answerId,
      requestId: ctx.requestId,
      capability: run.name,
      kind: run.descriptor.kind,
      surface: 'ai',
      selectedBy: run.selectedBy,
      outcome,
      errorCode: run.error?.code ?? null,
      inputHash: null,
      outputChars: run.outcome ? JSON.stringify(run.outcome.data).length : 0,
      durationMs: run.durationMs,
      at: ctx.now,
    });
  };

  const runTool = async (name: string, rawInput: unknown, selectedBy: AiToolSelector): Promise<SpotlightedSource[]> => {
    const descriptor = reg.get(name);
    if (!descriptor) return [];
    const t0 = performance.now();
    const result = await invoke(descriptor, ctx, rawInput);
    const run: ToolRun = { name, descriptor, selectedBy, durationMs: Math.round(performance.now() - t0), ...(result.ok ? { outcome: result.value } : { error: result.error }) };
    runs.push(run);
    await recordInvocation(run);
    if (!result.ok) {
      const e = result.error;
      if (e.code === 'confirmation_required') confirmations.push(confirmationCardFor(name, descriptor.title, 'This needs your confirmation on the website before anything changes.', { reason: 'requires_ui' }));
      else if (e.code === 'step_up_required') confirmations.push(confirmationCardFor(name, descriptor.title, 'For your security, confirm it is you on the website first.', { reason: 'step_up' }));
      else if (e.code === 'unauthenticated' || e.code === 'forbidden') toolsDenied.add(name);
      else services.logger?.warn({ capability: name, code: e.code, requestId: ctx.requestId }, 'concierge tool call failed');
      return [];
    }
    const outcome = result.value;
    const blocks = factsFromOutcome(descriptor, outcome, { next: nextMarker });
    if (outcome.confirmation) {
      confirmations.push(confirmationCardFor(name, descriptor.title, outcome.confirmation.summary, { reason: 'requires_ui', expiresAt: outcome.confirmation.expiresAt, proposal: outcome.data }));
    }
    if (outcome.handoffUrl) blocks.push({ marker: nextMarker(), citation: { sourceId: `capability:${name}` as never, title: descriptor.title, url: outcome.handoffUrl }, trust: 'EXTERNAL_DATA', lines: [`Continue securely with the provider at ${outcome.handoffUrl}.`], origin: name, retrievedAt: outcome.retrievedAt });
    sources.push(...blocks);
    return blocks;
  };

  // --- personal questions from anonymous callers: nothing to show, say so honestly
  if (plan.personal && ctx.principal.kind === 'anonymous') {
    const message = REFUSAL.signIn;
    await emit({ type: 'refusal', message, links: [{ label: 'Sign in', href: SIGN_IN_ROUTE }, CONTACT_LINK] });
    return finish({ status: 'refused', text: '', sources: [], refusal: { message, links: [{ label: 'Sign in', href: SIGN_IN_ROUTE }, CONTACT_LINK] } });
  }

  for (const call of plan.calls) await runTool(call.name, call.input, 'router');

  let navigate: ConciergeResult['navigate'];
  if (plan.navigate) {
    const nav = await runTool('navigate_to', plan.navigate, 'router');
    const navDescriptor = reg.get('navigate_to');
    const navRun = runs.find((r) => r.name === 'navigate_to');
    if (navRun?.outcome && navDescriptor) {
      navigate = navRun.outcome.data as { route: string; highlight?: string };
      const label = labelForRoute(navigate.route);
      sources.push({ marker: nextMarker(), citation: { sourceId: 'route' as never, title: label, url: navigate.route }, trust: 'TRUSTED_WEDDING', lines: [`The ${label} page is at ${navigate.route}.`], origin: 'navigate_to' });
      await emit({ type: 'navigate', ...navigate });
    }
    void nav;
  }

  // --- retrieval: the registered search capability, so it is audited and capped like any tool
  await emit({ type: 'status', stage: 'retrieving' });
  if (reg.get('search_wedding_information')) await runTool('search_wedding_information', { query: question.slice(0, 200), limit: cfg.AI_RETRIEVAL_LIMIT }, 'router');

  // --- trust: quarantine injected blocks, order evidence by trust, renumber markers
  for (const s of sources) {
    const findings = scanForInjection(`${s.citation.title}\n${s.lines.join('\n')}`);
    if (findings.length) {
      s.flagged = findings.map((f) => f.rule);
      await alert('source', { origin: s.origin, trust: s.trust, sourceId: s.citation.sourceId, rules: s.flagged.join(',') });
    }
  }
  const ordered = sortByTrust(sources);
  ordered.forEach((s, i) => {
    s.marker = `S${i + 1}`;
  });

  // --- generate
  await emit({ type: 'status', stage: 'generating' });
  const history: ModelMessage[] = session.turns.slice(-6).map((t) => ({ role: t.role, content: t.text }));
  const userTurn = `${renderQuestion(question)}\n\n${renderContext(ordered)}`;
  const modelTools = modelToolsFor(available, async (name, rawInput) => {
    const blocks = await runTool(name, rawInput, 'model');
    for (const b of blocks) {
      const f = scanForInjection(b.lines.join('\n'));
      if (f.length) {
        b.flagged = f.map((x) => x.rule);
        await alert('source', { origin: b.origin, trust: b.trust, sourceId: b.citation.sourceId, rules: b.flagged.join(',') });
      }
    }
    const visible = blocks.filter((b) => !b.flagged?.length);
    return visible.length ? visible.map(renderSourceBlock).join('\n') : 'No evidence was returned by that tool.';
  });

  const verified: VerifiedSentence[] = [];
  const kept: VerifiedSentence[] = [];
  let raw = '';
  let refusedBySentinel = false;
  const incremental = !models.live;
  const accept = async (s: VerifiedSentence) => {
    kept.push(s);
    if (incremental) await emit({ type: 'text', text: s.text });
  };
  try {
    const result = streamText({
      model: models.chat,
      system: systemPromptFor({ principalKind: ctx.principal.kind, toolNames: available.map((t) => t.descriptor.name) }),
      messages: [...history, { role: 'user', content: userTurn }],
      tools: modelTools,
      stopWhen: stepCountIs(1 + cfg.AI_MAX_TOOL_CALLS),
      maxOutputTokens: 600,
      abortSignal: AbortSignal.timeout(45_000),
    });
    let buffer = '';
    for await (const delta of result.textStream) {
      raw += delta;
      buffer += delta;
      if (isRefusalSentinel(raw)) {
        refusedBySentinel = true;
        continue;
      }
      const parts = splitSentences(buffer);
      if (parts.length > 1) {
        for (const complete of parts.slice(0, -1)) {
          const v = verifySentence(citedSentences(complete)[0]!, sources, { allowSmallTalk: true });
          verified.push(v);
          if (v.verdict === 'supported') await accept(v);
        }
        buffer = parts[parts.length - 1]!;
      }
    }
    if (!refusedBySentinel && buffer.trim()) {
      for (const s of citedSentences(buffer)) {
        const v = verifySentence(s, sources, { allowSmallTalk: true });
        verified.push(v);
        if (v.verdict === 'supported') await accept(v);
      }
    }
  } catch (cause) {
    services.logger?.error({ err: cause, requestId: ctx.requestId }, 'concierge generation failed');
    await emit({ type: 'error', code: 'provider_unavailable', message: REFUSAL.unavailable });
    return finish({ status: 'error', text: '', sources: [], refusal: { message: REFUSAL.unavailable, links: [CONTACT_LINK] } });
  }

  // --- verify (second pass with a live provider), then the deterministic gates
  await emit({ type: 'status', stage: 'verifying' });
  let survivors = kept;
  let method: AiVerifierSummary['method'] = 'deterministic';
  if (models.live && survivors.length) {
    method = 'deterministic+model';
    const checked = await verifyWithModel(models.verifier, survivors, sources, AbortSignal.timeout(20_000));
    for (const c of checked) if (c.verdict !== 'supported') verified[verified.indexOf(survivors.find((s) => s.text === c.text)!)] = c;
    survivors = checked.filter((c) => c.verdict === 'supported');
  }
  const byMarker = new Map(sources.map((s) => [s.marker, s]));
  const trustOf = (s: VerifiedSentence) => s.markers.map((m) => byMarker.get(m)?.trust).filter(Boolean);
  if (plan.protectedFact && !survivors.some((s) => trustOf(s).includes('TRUSTED_WEDDING'))) {
    survivors = [];
    verified.push({ text: `[gate:${plan.protectedFact}]`, plain: '', markers: [], verdict: 'unsupported', support: 0 });
  }
  survivors = survivors.map((s) => {
    const external = s.markers.map((m) => byMarker.get(m)).find((src) => src?.trust === 'EXTERNAL_DATA' && src.retrievedAt);
    if (external && !/\bas of\b/i.test(s.plain)) {
      const stamp = `As of ${external.retrievedAt!.replace('T', ' ').slice(0, 16)} UTC, `;
      return { ...s, text: `${stamp}${s.text}`, plain: `${stamp}${s.plain}` };
    }
    return s;
  });
  const summary = summarise(verified, method).summary;
  summary.supported = survivors.length;
  summary.dropped = Math.max(0, summary.claims - survivors.length);

  // --- assemble
  const routes = ordered.filter((s) => !s.flagged?.length).map((s) => s.citation.url ?? '').filter((u) => u.startsWith('/'));
  if (survivors.length === 0) {
    const undecided = plan.protectedFact ? REFUSAL.undecided(plan.protectedFact) : undefined;
    const message = undecided ?? (toolsDenied.size && plan.personal ? REFUSAL.signIn : REFUSAL.noSource);
    const links = undecided ? refusalLinks(['/the-wedding'], '/the-wedding') : refusalLinks(routes, '/ask-us');
    if (raw.trim() && !refusedBySentinel) {
      await ctx.audit.record({ actor, action: 'ai.grounding_failed', target: { type: 'ai_answer', id: answerId }, outcome: 'failed', requestId: ctx.requestId, metadata: { claims: summary.claims, dropped: summary.dropped, reasons: summary.reasons.join(','), intent: plan.intent } });
    }
    for (const card of confirmations) await emit({ type: 'confirmation', card });
    await emit({ type: 'refusal', message, links });
    return finish({ status: confirmations.length ? 'confirmation' : 'refused', text: '', sources: [], refusal: { message, links } });
  }
  if (summary.dropped > 0) {
    await ctx.audit.record({ actor, action: 'ai.grounding_failed', target: { type: 'ai_answer', id: answerId }, outcome: 'failed', requestId: ctx.requestId, metadata: { claims: summary.claims, dropped: summary.dropped, reasons: summary.reasons.join(','), intent: plan.intent, partial: true } });
  }
  if (!incremental) for (const s of survivors) await emit({ type: 'text', text: s.text });
  const citedMarkers: string[] = [];
  for (const s of survivors) for (const m of s.markers) if (byMarker.has(m) && !citedMarkers.includes(m)) citedMarkers.push(m);
  const answerSources: AnswerSource[] = citedMarkers.map((m) => {
    const src = byMarker.get(m)!;
    return citationToAnswerSource(m, src.citation, src.trust, src.retrievedAt);
  });
  await emit({ type: 'sources', sources: answerSources });
  for (const card of confirmations) await emit({ type: 'confirmation', card });
  const text = survivors.map((s) => s.text).join(' ');
  const status: AiAnswerStatus = confirmations.length ? 'confirmation' : summary.dropped > 0 ? 'partial' : 'grounded';
  return finish({ status, text, sources: answerSources });

  async function finish(partial: { status: AiAnswerStatus; text: string; sources: AnswerSource[]; refusal?: ConciergeResult['refusal'] }): Promise<ConciergeResult> {
    const latencyMs = Math.round(performance.now() - started);
    const shown = partial.text || partial.refusal?.message || '';
    await db.insert(aiAnswers).values({
      id: answerId,
      sessionId: session.id,
      requestId: ctx.requestId,
      principalKey: session.principalKey,
      principalKind: session.principalKind,
      question: redactForStorage(question, 600),
      answer: redactForStorage(shown, MAX_STORED_ANSWER_CHARS),
      status: partial.status,
      intent: plan.intent,
      toolsSelected: runs.map((r) => r.name),
      modelId: models.modelId,
      verifier: summary,
      securityAlerts,
      latencyMs,
      createdAt: ctx.now,
    });
    if (partial.sources.length) {
      await db.insert(aiAnswerSources).values(
        partial.sources.map((s) => ({
          id: newId(),
          answerId,
          marker: s.marker,
          sourceId: s.sourceId,
          title: s.title,
          url: s.url ?? null,
          verifiedAt: s.verifiedAt ? new Date(s.verifiedAt) : null,
          recordRef: s.recordRef ?? null,
          trustClass: s.trustClass,
          retrievedAt: s.retrievedAt ? new Date(s.retrievedAt) : null,
          cited: true,
        })),
      );
    }
    await appendTurns(db, session, [{ role: 'user', text: question, at: ctx.now.toISOString() }, { role: 'assistant', text: shown, at: ctx.now.toISOString(), answerId }], { keep: cfg.AI_SESSION_TURNS, now: ctx.now, retentionDays: cfg.AI_SESSION_RETENTION_DAYS });
    services.metrics?.counter('ai.answers', 1, { status: partial.status });
    services.metrics?.histogram('ai.answer_ms', latencyMs, { status: partial.status });
    try {
      await enqueueAiPurge(db, { now: ctx.now });
    } catch (cause) {
      services.logger?.warn({ err: cause }, 'could not enqueue ai purge');
    }
    await emit({ type: 'done', status: partial.status, dropped: summary?.dropped ?? 0, latencyMs });
    return {
      sessionId: session.id,
      answerId,
      status: partial.status,
      text: partial.text,
      sources: partial.sources,
      ...(partial.refusal ? { refusal: partial.refusal } : {}),
      confirmations,
      ...(navigate ? { navigate } : {}),
      intent: plan.intent,
      toolsSelected: runs.map((r) => r.name),
      toolsDenied: [...toolsDenied],
      dropped: summary?.dropped ?? 0,
      securityAlerts,
      latencyMs,
    };
  }
}

/** AI SDK tools for a live model: one per available capability, every call through `invoke`. */
function modelToolsFor(available: readonly RouterTool[], run: (name: string, input: unknown) => Promise<string>): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const t of available) {
    if (t.descriptor.name === 'ask_concierge') continue;
    out[t.descriptor.name] = tool({
      description: t.descriptor.description,
      inputSchema: jsonSchema(t.jsonSchema as never),
      execute: async (input: unknown) => run(t.descriptor.name, input),
    });
  }
  return out;
}

/** Route plan for tests and the admin trace page. */
export function planFor(question: string, ctx: Pick<CapabilityContext, 'principal' | 'flags'>, reg: CapabilityRegistryImpl = globalRegistry, maxCalls = aiConfig.AI_MAX_TOOL_CALLS): RoutePlan {
  return planRoute(question, toolsFor(ctx.principal, ctx.flags, reg), allAiTools(ctx.flags, reg), maxCalls);
}
