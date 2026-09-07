import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { TRUST_CLASSES } from '@/contracts/provenance';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { AI_ANSWER_STATUSES, AI_INVOCATION_OUTCOMES, aiAnswerSources, aiAnswers, capabilityInvocations } from '@/db/schema/ai';
import { listAuditEvents } from '@/lib/audit';
import { requireService } from './services';

const input = z
  .object({
    status: z.enum(AI_ANSWER_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional();

const traceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  requestId: z.string(),
  principalKind: z.string(),
  createdAt: z.string(),
  question: z.string(),
  answer: z.string(),
  status: z.enum(AI_ANSWER_STATUSES),
  intent: z.string(),
  modelId: z.string(),
  verifier: z.object({ method: z.string(), claims: z.number().int(), supported: z.number().int(), dropped: z.number().int(), reasons: z.array(z.string()) }),
  securityAlerts: z.number().int(),
  latencyMs: z.number().int(),
  sources: z.array(z.object({ marker: z.string(), title: z.string(), url: z.string().nullable(), verifiedAt: z.string().nullable(), retrievedAt: z.string().nullable(), trustClass: z.enum(TRUST_CLASSES) })),
  invocations: z.array(z.object({ capability: z.string(), kind: z.string(), selectedBy: z.string(), outcome: z.enum(AI_INVOCATION_OUTCOMES), errorCode: z.string().nullable(), durationMs: z.number().int(), outputChars: z.number().int() })),
});

const alertSchema = z.object({ id: z.string(), at: z.string(), action: z.string(), answerId: z.string(), requestId: z.string(), metadata: z.record(z.string(), z.unknown()).nullable() });

const output = z.object({
  answers: z.array(traceSchema),
  groundingFailures: z.array(alertSchema),
  securityAlerts: z.array(alertSchema),
  totals: z.object({ answers: z.number().int(), refused: z.number().int(), partial: z.number().int(), grounded: z.number().int() }),
});
export type AiTracesData = z.infer<typeof output>;

/**
 * Admin trace of the concierge: what was asked (redacted), what was shown (verified text only), the
 * verifier verdict, the sources and the tools that ran, plus grounding failures and security alerts
 * from the audit trail. There is no chain-of-thought to show: none is stored (ADR-0003).
 */
export const listAiTraces = defineCapability<z.infer<typeof input>, AiTracesData>({
  name: 'list_ai_traces',
  title: 'Concierge traces',
  description: 'Recent concierge answers with verifier verdicts, cited sources, tool invocations, grounding failures and security alerts. Admin only. Read only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_ai'],
  flag: 'AI_CONCIERGE',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 64_000,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const limit = i?.limit ?? 50;
    const rows = await db
      .select()
      .from(aiAnswers)
      .where(i?.status ? eq(aiAnswers.status, i.status) : undefined)
      .orderBy(desc(aiAnswers.createdAt))
      .limit(limit);
    const ids = rows.map((r) => r.id);
    const [sources, invocations, failures, alerts, all] = await Promise.all([
      ids.length ? db.select().from(aiAnswerSources).where(inArray(aiAnswerSources.answerId, ids)) : Promise.resolve([]),
      ids.length ? db.select().from(capabilityInvocations).where(inArray(capabilityInvocations.answerId, ids)).orderBy(capabilityInvocations.at) : Promise.resolve([]),
      listAuditEvents(db, { action: 'ai.grounding_failed', limit }),
      listAuditEvents(db, { action: 'ai.security_alert', limit }),
      db.select({ status: aiAnswers.status }).from(aiAnswers),
    ]);
    const answers = rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      requestId: r.requestId,
      principalKind: r.principalKind,
      createdAt: r.createdAt.toISOString(),
      question: r.question,
      answer: r.answer,
      status: r.status,
      intent: r.intent,
      modelId: r.modelId,
      verifier: r.verifier,
      securityAlerts: r.securityAlerts,
      latencyMs: r.latencyMs,
      sources: sources
        .filter((s) => s.answerId === r.id)
        .map((s) => ({ marker: s.marker, title: s.title, url: s.url, verifiedAt: s.verifiedAt?.toISOString() ?? null, retrievedAt: s.retrievedAt?.toISOString() ?? null, trustClass: s.trustClass })),
      invocations: invocations
        .filter((x) => x.answerId === r.id)
        .map((x) => ({ capability: x.capability, kind: x.kind, selectedBy: x.selectedBy, outcome: x.outcome, errorCode: x.errorCode, durationMs: x.durationMs, outputChars: x.outputChars })),
    }));
    const toAlert = (e: (typeof failures)[number]) => ({ id: e.id, at: e.at.toISOString(), action: e.action, answerId: e.targetId, requestId: e.requestId, metadata: e.metadata });
    const count = (s: string) => all.filter((a) => a.status === s).length;
    return ok({
      data: { answers, groundingFailures: failures.map(toAlert), securityAlerts: alerts.map(toAlert), totals: { answers: all.length, refused: count('refused'), partial: count('partial'), grounded: count('grounded') } },
      sources: [],
    });
  },
});
