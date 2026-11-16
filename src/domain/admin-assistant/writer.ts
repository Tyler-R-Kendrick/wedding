import { VIEWS, isViewName } from './catalog';
import type { Answer, Intent } from './types';

/**
 * The two jobs the browser's built-in model may do for the console, both optional and both checked.
 *
 * 1. Choose. When the router (./intent.ts) cannot tell what a message asks for, the model is shown
 *    the list of views and replies with one line naming a view. It chooses which records to read;
 *    it never sees or states a record.
 * 2. Say. Given the facts an answer was composed from, it may put the answer in a sentence or two.
 *    `acceptSaid` keeps that only when every figure in it is a figure from the facts; anything else
 *    is dropped and the composer's own sentence stays.
 *
 * No hosted model is involved: prompts run on the administrator's device (src/lib/ai/browser-model.ts).
 */

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const CHOOSE = `You route questions for a wedding website's admin console. Pick the ONE view that answers the question.
Reply with exactly one line in this form and nothing else:
VIEW: <name> | window=<24, 168 or 720, only if a time span is named> | subject=<a guest's name or the thing to edit, only if one is named>

Views:
${VIEWS.map((v) => `${v.name}: ${v.does}. Example: "${v.example}"`).join('\n')}

Example
Question: did many people look at the hotel page since yesterday
VIEW: traffic | window=24`;

export function choosePrompt(message: string): { system: string; prompt: string } {
  return { system: CHOOSE, prompt: `Question: ${clip(oneLine(message), 300)}` };
}

/** The model's choice, or null when its reply is not a view on the list. */
export function parseChoice(reply: string | null | undefined): Partial<Intent> | null {
  if (!reply) return null;
  const line = reply.split('\n').find((l) => /view\s*[*_`]*\s*[:：]/i.test(l));
  if (!line) return null;
  const view = /view\s*[*_`]*\s*[:：][\s*_`"']*([a-z]+)/i.exec(line)?.[1]?.toLowerCase();
  if (!isViewName(view) || view === 'help') return null;
  const window = Number(/window\s*=\s*(\d+)/i.exec(line)?.[1]);
  const subject = /subject\s*=\s*([^|]+)/i.exec(line)?.[1]?.replace(/[<>"'`*_]/g, '').trim();
  return { view, ...([24, 168, 720].includes(window) ? { window } : {}), ...(subject && subject.length < 60 && !/^(none|n\/a|null|-)$/i.test(subject) ? { subject } : {}) };
}

const SAY = `You write one or two short, plain sentences for a wedding website's admin console, answering the administrator's question from the facts given.
Rules: use only the facts. Never state a number, name, page or time that is not in the facts. No greeting, no advice the facts do not support, no exclamation marks, no emoji, no lists. Lead with the answer.`;

export function sayPrompt(message: string, answer: Pick<Answer, 'facts' | 'summary'>): { system: string; prompt: string } {
  return { system: SAY, prompt: [`Question: ${clip(oneLine(message), 300)}`, `Facts:\n${answer.facts.slice(0, 14).map((f) => `- ${clip(oneLine(f), 180)}`).join('\n')}`, `Our draft: ${answer.summary}`].join('\n\n') };
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (text: string) => (text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));
const OFF_LIMITS = /\b(as an ai|language model|i (cannot|can't|am unable)|prompt|openui)\b/i;

/**
 * What the model said, made safe to show, or null to keep the composer's sentence. A sentence is
 * kept only if every number in it appears in the facts (or the draft), it is not a refusal, and it
 * is a sentence or two rather than an essay.
 */
export function acceptSaid(said: string | null | undefined, answer: Pick<Answer, 'facts' | 'summary'>): string | null {
  if (!said) return null;
  const text = oneLine(said.replace(/[*_`#>]+/g, '').replace(/\p{Extended_Pictographic}|\u{FE0F}/gu, '').replace(/!+/g, '.'));
  if (text.length < 12 || text.length > 320 || OFF_LIMITS.test(text)) return null;
  const allowed = new Set(numbersIn(`${answer.facts.join(' ')} ${answer.summary}`));
  if (numbersIn(text).some((n) => !allowed.has(n))) return null;
  return /[.?]$/.test(text) ? text : `${text}.`;
}
