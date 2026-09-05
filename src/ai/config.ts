import 'server-only';
import { z } from 'zod';

/**
 * Concierge configuration. Read here (not in src/lib/env.ts, which belongs to the foundation)
 * so this level adds no contract changes; the report proposes moving these rows there.
 * Every value has a production-safe default; malformed values fail fast at first import.
 */
const intish = (fallback: number, min: number, max: number) => z.preprocess((v) => (v === undefined || v === '' ? fallback : Number(v)), z.number().int().min(min).max(max));

const schema = z.object({
  /** Days a session (and its answers, sources, invocations) is kept before `ai.purge_sessions` deletes it. */
  AI_SESSION_RETENTION_DAYS: intish(7, 1, 90),
  /** Redacted turns kept per session for follow-ups. */
  AI_SESSION_TURNS: intish(10, 2, 40),
  /** Deterministic router: most capabilities invoked per question (retrieval excluded). */
  AI_MAX_TOOL_CALLS: intish(4, 1, 8),
  /** Longest question accepted (chars). */
  AI_MAX_QUESTION_CHARS: intish(2000, 100, 8000),
  /** Retrieval over knowledge_records: keyword search now, embeddings + vector index when `hybrid`. */
  AI_RETRIEVAL_MODE: z.enum(['static', 'hybrid']).default('static'),
  /** Retrieved chunks offered to the model. */
  AI_RETRIEVAL_LIMIT: intish(6, 1, 20),
  /** Test-only principal injector (constant-time compared). Only honoured under NODE_ENV=test. */
  TEST_AUTH_SECRET: z.string().min(16).optional().or(z.literal('').transform(() => undefined)),
});

export type AiConfig = z.infer<typeof schema>;

function load(source: Record<string, string | undefined>): AiConfig {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid concierge environment:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}

export const aiConfig: AiConfig = load(process.env);

/** For tests. */
export const parseAiConfig = (source: Record<string, string | undefined>): AiConfig => load(source);
