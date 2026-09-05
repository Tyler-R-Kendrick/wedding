import { generateText, type LanguageModel } from 'ai';
import type { TrustClass } from '@/contracts/provenance';
import type { AiVerifierSummary } from '@/db/schema/ai';
import { citedSentences, type CitedSentence } from './citations';
import { contentTokens, hardTokens, overlap, stemmedSet } from './text';
import type { SpotlightedSource } from './types';

/**
 * Source-support verifier (ADR-0003 rule 5). Runs after generation, on every answer, whatever the
 * model. A sentence survives only when:
 *   1. it cites at least one marker that exists in the evidence offered to the model;
 *   2. at least one cited source is TRUSTED_WEDDING or EXTERNAL_DATA (guest-written text is data,
 *      never a wedding fact) unless the caller explicitly allows untrusted quotes;
 *   3. its content words are supported by the cited sources (overlap ratio >= SUPPORT_RATIO) and
 *      every number/time/price in it appears literally in those sources.
 * Anything else is dropped; the answer is marked partial; nothing left means refusal.
 * With a live provider a second, cheaper model pass (role `verifier`) must ALSO accept the claim.
 */
export const SUPPORT_RATIO = 0.5;
export const NO_SOURCE_SENTINEL = 'NO_SOURCE';

export type Verdict = 'supported' | 'uncited' | 'unknown-marker' | 'untrusted-only' | 'unsupported' | 'model-rejected';

export interface VerifiedSentence extends CitedSentence {
  verdict: Verdict;
  support: number;
}

export interface VerifyOptions {
  allowUntrusted?: boolean;
  /** Sentences that are pure conversation ("Happy to help.") carry no fact and pass without citations. */
  allowSmallTalk?: boolean;
}

const SMALL_TALK = /^(happy to help|of course|sure|certainly|you're welcome|glad to help|hello|hi there|thanks)[!. ]*$/i;

export function isRefusalSentinel(text: string): boolean {
  return text.trim().toUpperCase().startsWith(NO_SOURCE_SENTINEL);
}

function supportScore(sentence: CitedSentence, cited: readonly SpotlightedSource[]): number {
  const claimTokens = contentTokens(sentence.plain);
  if (claimTokens.length === 0) return 1;
  const haystack = stemmedSet(cited.flatMap((s) => [...contentTokens(s.citation.title), ...s.lines.flatMap((l) => contentTokens(l))]));
  const matched = overlap(claimTokens, haystack);
  const ratio = matched / claimTokens.length;
  const hard = hardTokens(sentence.plain);
  if (hard.length) {
    const sourceText = cited.map((s) => `${s.citation.title}\n${s.lines.join('\n')}`).join('\n').toLowerCase().replace(/\s+/g, '');
    for (const h of hard) if (!sourceText.includes(h)) return Math.min(ratio, SUPPORT_RATIO - 0.01);
  }
  return ratio;
}

/** Deterministic pass. Pure; safe to run per sentence while streaming. */
export function verifySentence(sentence: CitedSentence, sources: readonly SpotlightedSource[], opts: VerifyOptions = {}): VerifiedSentence {
  if (sentence.markers.length === 0) {
    if (opts.allowSmallTalk && SMALL_TALK.test(sentence.plain)) return { ...sentence, verdict: 'supported', support: 1 };
    return { ...sentence, verdict: 'uncited', support: 0 };
  }
  const byMarker = new Map(sources.map((s) => [s.marker, s]));
  const cited = sentence.markers.map((m) => byMarker.get(m)).filter((s): s is SpotlightedSource => !!s && !s.flagged?.length);
  if (cited.length === 0) return { ...sentence, verdict: 'unknown-marker', support: 0 };
  const trusted: TrustClass[] = ['TRUSTED_WEDDING', 'EXTERNAL_DATA'];
  if (!opts.allowUntrusted && !cited.some((s) => trusted.includes(s.trust))) return { ...sentence, verdict: 'untrusted-only', support: 0 };
  const support = supportScore(sentence, cited);
  return { ...sentence, verdict: support >= SUPPORT_RATIO ? 'supported' : 'unsupported', support };
}

export interface VerificationResult {
  sentences: VerifiedSentence[];
  kept: VerifiedSentence[];
  summary: AiVerifierSummary;
}

export function verifyAnswer(text: string, sources: readonly SpotlightedSource[], opts: VerifyOptions = {}): VerificationResult {
  const sentences = citedSentences(text).map((s) => verifySentence(s, sources, opts));
  return summarise(sentences, 'deterministic');
}

export function summarise(sentences: readonly VerifiedSentence[], method: AiVerifierSummary['method']): VerificationResult {
  const kept = sentences.filter((s) => s.verdict === 'supported');
  const reasons = [...new Set(sentences.filter((s) => s.verdict !== 'supported').map((s) => s.verdict))];
  return { sentences: [...sentences], kept, summary: { method, claims: sentences.length, supported: kept.length, dropped: sentences.length - kept.length, reasons } };
}

/**
 * Second pass with a language model in the `verifier` role: given each claim and the exact text it
 * cites, answer SUPPORTED or UNSUPPORTED. Structured (JSON) output, parsed defensively: anything
 * that is not an explicit SUPPORTED counts as rejected. Never called with the mock provider in CI
 * paths that need determinism; unit-tested with a MockLanguageModelV4.
 */
export async function verifyWithModel(model: LanguageModel, kept: readonly VerifiedSentence[], sources: readonly SpotlightedSource[], abortSignal?: AbortSignal): Promise<VerifiedSentence[]> {
  if (kept.length === 0) return [];
  const byMarker = new Map(sources.map((s) => [s.marker, s]));
  const claims = kept.map((s, i) => ({
    id: i + 1,
    claim: s.plain,
    evidence: s.markers
      .map((m) => byMarker.get(m))
      .filter((x): x is SpotlightedSource => !!x)
      .map((x) => `${x.marker}: ${x.lines.join(' ')}`)
      .join('\n'),
  }));
  const prompt =
    'You are a strict fact checker. For each claim decide whether the evidence quoted for it fully supports it. ' +
    'Answer with JSON only: {"verdicts":[{"id":1,"verdict":"SUPPORTED"|"UNSUPPORTED"}]}.\n\n' +
    claims.map((c) => `Claim ${c.id}: ${c.claim}\nEvidence:\n${c.evidence}`).join('\n\n');
  let verdicts = new Map<number, string>();
  try {
    const { text } = await generateText({ model, prompt, abortSignal, maxOutputTokens: 400 });
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? (JSON.parse(json) as { verdicts?: { id: number; verdict: string }[] }) : undefined;
    verdicts = new Map((parsed?.verdicts ?? []).map((v) => [Number(v.id), String(v.verdict).toUpperCase()]));
  } catch {
    verdicts = new Map();
  }
  return kept.map((s, i) => (verdicts.get(i + 1) === 'SUPPORTED' ? s : { ...s, verdict: 'model-rejected' as const }));
}
