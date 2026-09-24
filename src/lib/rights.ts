import type { MetadataRoute } from 'next';

/**
 * The machine-readable half of LICENSE's "Reserved content": Sara and Tyler's photographs and
 * likeness are not licensed to anyone, and in particular not for text and data mining or AI
 * training. The human-readable half is LICENSE, public/assets/photos/LICENSE.txt and /credits#rights;
 * the statement embedded in each photo file is scripts/stamp-photo-rights.mjs.
 *
 * None of these signals is enforcement. A crawler can ignore robots.txt and a header, and a scraper
 * can strip XMP. What they do is make the reservation explicit and machine-readable, which is what
 * the EU's TDM exception (Directive 2019/790 art. 4(3)) asks of a rightsholder, and what the crawlers
 * named below say they honour.
 */

/** Paths whose files are the couple's own images (LICENSE, "Reserved content"). */
export const RESERVED_IMAGE_PATHS = ['/assets/photos/', '/media/botanical-deco/couple/'] as const;

/**
 * Crawlers that collect for AI training, AI answers or AI datasets, by the user-agent token their
 * operators publish. Each is refused the whole site; ordinary search crawlers are refused only the
 * couple's images (the site is `noindex` throughout anyway).
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'Google-Extended',
  'GoogleOther',
  'Applebot-Extended',
  'CCBot',
  'PerplexityBot',
  'Perplexity-User',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'meta-externalfetcher',
  'FacebookBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'YouBot',
  'DuckAssistBot',
  'MistralAI-User',
  'Timpibot',
  'ImagesiftBot',
  'img2dataset',
  'omgili',
  'Webzio-Extended',
  'PanguBot',
  'Kangaroo Bot',
] as const;

export function robotsRules(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: [...AI_CRAWLERS], disallow: '/' },
      { userAgent: '*', allow: '/', disallow: [...RESERVED_IMAGE_PATHS] },
    ],
  };
}

/** `X-Robots-Tag` directives: `noai`/`noimageai` are the de facto opt-out read by image dataset tools. */
const NO_AI = 'noai, noimageai';
const NO_INDEX_IMAGE = 'noindex, noimageindex, noai, noimageai';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

/**
 * Response headers for next.config.ts. The site-wide rule comes first: when two rules set the same
 * key, Next keeps the later one, so the image rules' stricter `X-Robots-Tag` wins on those paths.
 * `tdm-reservation: 1` is the W3C TDM Reservation Protocol; /.well-known/tdmrep.json says the same
 * for the whole origin.
 */
export function rightsHeaders(): HeaderRule[] {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'tdm-reservation', value: '1' },
        { key: 'X-Robots-Tag', value: NO_AI },
      ],
    },
    ...RESERVED_IMAGE_PATHS.map((p) => ({ source: `${p}:path*`, headers: [{ key: 'X-Robots-Tag', value: NO_INDEX_IMAGE }] })),
  ];
}
