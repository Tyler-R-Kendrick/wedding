import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Prompt, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * Deterministic, extractive stand-in for the concierge model (CI, previews, evals).
 *
 * It behaves like an obedient grounded model: it reads the evidence blocks in the latest user turn,
 * picks the lines that overlap the question, and returns them verbatim with citations. It never
 * calls tools, never adds words that are not in a block, and answers NO_SOURCE when nothing
 * overlaps. Because it is extractive, an injected instruction inside a block can only ever come
 * back as a quoted line, which the verifier and trust rules then reject. It knows nothing about the
 * wedding: everything it says comes from the prompt.
 */
export const NO_SOURCE = 'NO_SOURCE';

const STOP = new Set(
  'a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its me my of on or our she so than that the their them then there these they this to us was we were what when where which who whom why will with would you your about after before also any been being both during each few here more most other over own same some such too under until up very just yes no not ok okay please tell give show know want need like get got make going go come im ive id youre theyre isnt arent dont doesnt didnt cant wont s t'.split(
    /\s+/,
  ),
);

const stem = (t: string) => t.replace(/(ations?|ings?|ers?|ies|ed|es|s)$/u, (m) => (t.length - m.length >= 3 ? '' : m));

/**
 * A real grounded model knows that "kids" and "children" are the same question and that "met" is
 * "meet". The stand-in needs the same tolerance or it refuses on vocabulary rather than on evidence,
 * which would make the eval numbers a measure of this file instead of the pipeline. It is only ever
 * a widening of matching: nothing here invents a fact, and every line returned is still verbatim.
 */
const SYNONYMS: Record<string, string> = {
  met: 'meet', meeting: 'meet', children: 'kid', child: 'kid', kids: 'kid', kid: 'kid',
  attire: 'dress', wear: 'dress', wearing: 'dress', outfit: 'dress', dresscode: 'dress',
  begin: 'start', begins: 'start', starts: 'start', starting: 'start', commence: 'start',
  auto: 'car', vehicle: 'car', driving: 'drive', park: 'parking',
  lodging: 'hotel', accommodation: 'hotel', stay: 'hotel', room: 'room', rooms: 'room',
  present: 'gift', presents: 'gift', registry: 'gift', gifts: 'gift',
  eat: 'food', dining: 'food', dinner: 'food', menu: 'food', meal: 'food',
  wheelchair: 'accessible', accessibility: 'accessible', ada: 'accessible',
  photograph: 'photo', photos: 'photo', pictures: 'photo', picture: 'photo', camera: 'photo',
};

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(raw);
    out.add(stem(raw));
    const synonym = SYNONYMS[raw];
    if (synonym) {
      out.add(synonym);
      out.add(stem(synonym));
    }
  }
  return out;
}

interface Block {
  id: string;
  trust: string;
  title: string;
  lines: string[];
  order: number;
}

const TRUST_WEIGHT: Record<string, number> = { TRUSTED_WEDDING: 1, EXTERNAL_DATA: 0.9, UNTRUSTED_USER_CONTENT: 0.4 };
const PREFACE = /^(Guest-written text\.|External data\.)/;

export function lastUserText(prompt: LanguageModelV4Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i]!;
    if (m.role !== 'user') continue;
    return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
  }
  return '';
}

export function parseBlocks(text: string): { question: string; blocks: Block[] } {
  const question = text.match(/<question>\s*([\s\S]*?)\s*<\/question>/)?.[1] ?? text;
  const blocks: Block[] = [];
  const re = /<(source|untrusted-content)\s+([^>]*)>\n?([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(text))) {
    const attrs = m[2] ?? '';
    const id = attrs.match(/\bid="([^"]+)"/)?.[1] ?? `S${order + 1}`;
    const trust = attrs.match(/\btrust="([^"]+)"/)?.[1] ?? 'UNTRUSTED_USER_CONTENT';
    const title = attrs.match(/\btitle="([^"]*)"/)?.[1] ?? '';
    const lines = (m[3] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !PREFACE.test(l));
    blocks.push({ id, trust, title, lines, order: order++ });
  }
  return { question, blocks };
}

/** The extractive answer for a rendered prompt. Exported so unit tests can pin the behaviour. */
export function extractiveAnswer(prompt: LanguageModelV4Prompt, maxSentences = 3): string {
  const { question, blocks } = parseBlocks(lastUserText(prompt));
  const q = tokens(question);
  if (q.size === 0 || blocks.length === 0) return NO_SOURCE;
  const scored: { score: number; block: Block; line: string; index: number }[] = [];
  for (const block of blocks) {
    const titleTokens = tokens(block.title);
    let titleHits = 0;
    for (const t of titleTokens) if (q.has(t)) titleHits++;
    block.lines.forEach((line, index) => {
      const lt = tokens(line);
      let hits = 0;
      for (const t of lt) if (q.has(t)) hits++;
      if (hits === 0 && titleHits === 0) return;
      const undecidedBoost = /not yet decided/.test(line) ? 0.25 : 0;
      const score = (hits + titleHits * 0.5 + undecidedBoost) * (TRUST_WEIGHT[block.trust] ?? 0.4);
      if (hits >= 1 || titleHits >= 2) scored.push({ score, block, line, index });
    });
  }
  scored.sort((a, b) => b.score - a.score || a.block.order - b.block.order || a.index - b.index);
  const perBlock = new Map<string, number>();
  const chosen: typeof scored = [];
  for (const s of scored) {
    const used = perBlock.get(s.block.id) ?? 0;
    if (used >= 2) continue;
    perBlock.set(s.block.id, used + 1);
    chosen.push(s);
    if (chosen.length >= maxSentences) break;
  }
  if (chosen.length === 0) return NO_SOURCE;
  return chosen.map((c) => `${c.line.replace(/[.!?]+$/, '')} [${c.block.id}].`).join(' ');
}

/** Deterministic verifier: SUPPORTED when at least half of a claim's content tokens appear in its evidence. */
export function extractiveVerdicts(prompt: LanguageModelV4Prompt): string {
  const text = lastUserText(prompt);
  const verdicts: { id: number; verdict: 'SUPPORTED' | 'UNSUPPORTED' }[] = [];
  const re = /Claim (\d+): ([\s\S]*?)\nEvidence:\n([\s\S]*?)(?=\n\nClaim \d+:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const claim = tokens(m[2] ?? '');
    const evidence = tokens(m[3] ?? '');
    let hits = 0;
    for (const t of claim) if (evidence.has(t)) hits++;
    verdicts.push({ id: Number(m[1]), verdict: claim.size === 0 || hits / claim.size >= 0.5 ? 'SUPPORTED' : 'UNSUPPORTED' });
  }
  return JSON.stringify({ verdicts });
}

const usage = (text: string): LanguageModelV4Usage => ({
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: Math.max(1, Math.ceil(text.length / 4)), text: Math.max(1, Math.ceil(text.length / 4)), reasoning: undefined },
});

function generateResult(text: string): LanguageModelV4GenerateResult {
  return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage: usage(text), warnings: [] };
}

function streamResult(text: string) {
  const chunks = text.split(/(?<=\.)\s+/).filter(Boolean);
  const parts: LanguageModelV4StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    ...chunks.map((c, i): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 't1', delta: i < chunks.length - 1 ? `${c} ` : c })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usage(text) },
  ];
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    }),
  };
}

function scripted(modelId: string, answer: (options: LanguageModelV4CallOptions) => string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId,
    doGenerate: async (options) => generateResult(answer(options)),
    doStream: async (options) => streamResult(answer(options)),
  });
}

/** Chat role: extractive, cited, closed-world. */
export const createExtractiveMockModel = (modelId = 'mock-chat'): MockLanguageModelV4 => scripted(modelId, (o) => extractiveAnswer(o.prompt));

/** Verifier role: deterministic SUPPORTED/UNSUPPORTED JSON. */
export const createMockVerifierModel = (modelId = 'mock-verifier'): MockLanguageModelV4 => scripted(modelId, (o) => extractiveVerdicts(o.prompt));
