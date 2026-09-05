import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { DEFAULT_CALL_POLICY, type ProviderErrorClass } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import type { ProviderFailure } from '@/contracts/providers';
import { failure, okConfig, upHealth } from '../base';
import { MEDIA_AI_VENUE_CLASSES, type MediaAiProvider, type MediaAnnotation, type MediaRef } from './types';

/**
 * Captions through the caption-role model of the ai-model provider (Claude Haiku by default).
 * The image is sent as bytes of a web-sized, metadata-stripped derivative; the model is asked for
 * strict JSON and the answer is validated before it becomes a suggestion. The adapter never sees
 * originals and never decides whether it may run: the domain applies PRO_MEDIA_AI_PROCESSING first.
 */
export const ANNOTATION_PROMPT =
  'You describe a wedding-weekend photo for a private family archive. Reply with ONLY a JSON object: ' +
  '{"caption": string (<= 140 chars, plain, no names, no guesses about who people are), ' +
  '"altText": string (<= 200 chars, one sentence for a screen reader), ' +
  '"tags": string[] (3-8 lowercase single words such as ceremony, toast, dancing, portrait, candid, flowers, architecture, food, family, friends, outdoor, indoor), ' +
  `"venueClass": one of ${MEDIA_AI_VENUE_CLASSES.map((v) => `"${v}"`).join(', ')}, ` +
  '"confidence": number 0..1}. Never identify people. Never mention text you cannot read. No markdown.';

const annotationSchema = z.object({
  caption: z.string().trim().min(1).max(280),
  altText: z.string().trim().min(1).max(400),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(12).default([]),
  venueClass: z.enum(MEDIA_AI_VENUE_CLASSES).catch('unknown'),
  confidence: z.number().min(0).max(1).catch(0.5),
});

/** Parses the model's text (tolerating code fences and prose around the object). Null when unusable. */
export function parseAnnotationJson(text: string): Omit<MediaAnnotation, 'model'> | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = annotationSchema.safeParse(raw);
  if (!parsed.success) return null;
  const tags = [...new Set(parsed.data.tags.map((t) => t.replace(/[^a-z0-9-]/g, '')).filter(Boolean))].slice(0, 8);
  return { caption: parsed.data.caption, altText: parsed.data.altText, tags, venueClass: parsed.data.venueClass, confidence: parsed.data.confidence };
}

function classify(e: unknown): ProviderErrorClass {
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status !== undefined && status >= 400 && status < 500) return 'bad_request';
  return 'server';
}

export class AnthropicVisionMediaAi implements MediaAiProvider {
  readonly kind = 'media-ai' as const;
  readonly name = 'anthropic-vision';
  readonly mode = 'live' as const;
  readonly capabilities = { caption: true, describeScenes: false, tags: true, annotate: true };

  constructor(private readonly languageModel: () => LanguageModel, private readonly timeoutMs: number = DEFAULT_CALL_POLICY.timeoutMs * 2) {}

  validateConfig() {
    return okConfig(['captions are suggestions: an admin applies them; professional media needs PRO_MEDIA_AI_PROCESSING + written confirmation']);
  }
  async health() {
    return upHealth('caption model via ai-model provider');
  }

  async annotate(media: MediaRef): Promise<Result<MediaAnnotation, ProviderFailure>> {
    if (!media.bytes || media.bytes.byteLength === 0) return err(failure(this.name, 'bad_request', 'No image bytes were supplied.'));
    if (!media.contentType?.startsWith('image/')) return err(failure(this.name, 'bad_request', 'Only image derivatives can be captioned.'));
    try {
      const { generateText } = await import('ai');
      const model = this.languageModel();
      const result = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: media.bytes, mediaType: media.contentType },
              { type: 'text', text: ANNOTATION_PROMPT },
            ],
          },
        ],
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = parseAnnotationJson(result.text);
      if (!parsed) return err(failure(this.name, 'malformed_response', 'The caption service returned something we could not use.', { raw: result.text.slice(0, 500) }));
      const modelId = typeof model === 'string' ? model : ((model as { modelId?: string }).modelId ?? 'anthropic');
      return ok({ ...parsed, model: modelId });
    } catch (e) {
      return err(failure(this.name, classify(e), 'Captions are not available right now.', { raw: e }));
    }
  }

  async caption(media: MediaRef) {
    const a = await this.annotate(media);
    return a.ok ? ok({ caption: a.value.caption, confidence: a.value.confidence, model: a.value.model }) : a;
  }

  async describeScenes() {
    return err(failure(this.name, 'bad_request', 'Scene descriptions are not available for this provider.'));
  }

  async tags(media: MediaRef, opts: { max?: number } = {}) {
    const a = await this.annotate(media);
    return a.ok ? ok(a.value.tags.slice(0, opts.max ?? 8)) : a;
  }
}
