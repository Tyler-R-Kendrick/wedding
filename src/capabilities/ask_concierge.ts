import { z } from 'zod';
import { runConcierge } from '@/ai/concierge';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { TRUST_CLASSES } from '@/contracts/provenance';
import { AI_ANSWER_STATUSES } from '@/db/schema/ai';

const input = z.object({
  question: z.string().trim().min(2).max(2000),
  /** Continue an earlier conversation. Another principal's session id silently starts a new one. */
  sessionId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
});

const linkSchema = z.object({ label: z.string(), href: z.string() });
const answerSourceSchema = z.object({
  marker: z.string(),
  sourceId: z.string(),
  title: z.string(),
  url: z.string().optional(),
  verifiedAt: z.string().optional(),
  retrievedAt: z.string().optional(),
  trustClass: z.enum(TRUST_CLASSES),
  recordRef: z.object({ type: z.string(), id: z.string() }).optional(),
});
const confirmationCardSchema = z.object({
  capability: z.string(),
  title: z.string(),
  summary: z.string(),
  reviewRoute: z.string(),
  expiresAt: z.string().optional(),
  proposal: z.unknown().optional(),
  reason: z.enum(['requires_ui', 'step_up', 'sign_in']),
});

const output = z.object({
  sessionId: z.string(),
  answerId: z.string(),
  status: z.enum(AI_ANSWER_STATUSES),
  /** Verified sentences with citation markers such as "[S1]". Empty when refused. */
  text: z.string(),
  sources: z.array(answerSourceSchema),
  refusal: z.object({ message: z.string(), links: z.array(linkSchema) }).optional(),
  confirmations: z.array(confirmationCardSchema),
  navigate: z.object({ route: z.string(), highlight: z.string().optional() }).optional(),
  intent: z.string(),
  toolsSelected: z.array(z.string()),
});
export type AskConciergeData = z.infer<typeof output>;

/**
 * Non-streaming door into the concierge for the website and WebMCP. The model is never offered this
 * tool (exposure.ai is false: a model must not recurse into the concierge). Answers only from
 * capabilities the caller may invoke and from knowledge the caller may see; every fact is cited and
 * verified; a refusal with links is a success. Persists a redacted, expiring trace (ADR-0003).
 */
export const askConcierge = defineCapability<z.infer<typeof input>, AskConciergeData>({
  name: 'ask_concierge',
  title: 'Ask the concierge',
  description:
    "Answers a guest's question about the wedding from the site's own content and the caller's own data, with a citation for every sentence. " +
    'Says when something is not yet decided or not on the site. Never books, submits, or changes anything: consequential requests come back as confirmation cards for the website.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  flag: 'AI_CONCIERGE',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, { question, sessionId }) {
    const result = await runConcierge({ ctx, question, sessionId });
    const { sessionId: sid, answerId, status, text, sources, refusal, confirmations, navigate, intent, toolsSelected } = result;
    return ok({
      data: { sessionId: sid, answerId, status, text, sources, ...(refusal ? { refusal } : {}), confirmations, ...(navigate ? { navigate } : {}), intent, toolsSelected },
      sources: sources.map((s) => ({ sourceId: s.sourceId as never, title: s.title, url: s.url, verifiedAt: s.verifiedAt, recordRef: s.recordRef })),
    });
  },
});
