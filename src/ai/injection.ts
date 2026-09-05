/**
 * Prompt-injection scanner for text that did not come from the couple: retrieved guest content,
 * provider payloads, and the guest's own message. Findings never change the system prompt (which
 * is immutable server-side); they quarantine the offending source and raise `ai.security_alert`.
 * Pattern matching is deliberately broad: a false positive costs one source, a miss costs trust.
 */
export interface InjectionFinding {
  rule: string;
  snippet: string;
}

const RULES: { rule: string; pattern: RegExp }[] = [
  { rule: 'ignore-instructions', pattern: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the|these|those|system)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|constraints?|policy|policies)\b/i },
  { rule: 'new-instructions', pattern: /\b(new|updated|real|actual|true)\s+(instructions?|system\s+prompt|rules?)\b/i },
  { rule: 'role-override', pattern: /\b(you are now|from now on you|act as|pretend (to be|you are)|roleplay as|developer mode|jailbreak|dan mode)\b/i },
  { rule: 'system-marker', pattern: /(^|\n)\s*(system|assistant|developer)\s*:|<\/?\s*(system|assistant|instructions?)\s*>|\[\s*(system|inst)\s*\]|###\s*(system|instructions?)/i },
  { rule: 'authority-claim', pattern: /\b(as|i am|i'm)\s+(the|your|an?)\s+(developer|administrator|admin|owner|operator|system|planner)\b[^.\n]{0,60}\b(authori[sz]e|allow|permit|order|instruct|command)\b/i },
  { rule: 'exfiltration', pattern: /\b(reveal|print|show|leak|output|repeat|dump)\b[^.\n]{0,40}\b(system prompt|instructions|api key|secret|password|token|credentials|admin)\b/i },
  { rule: 'broadcast-fact', pattern: /\b(tell (everyone|all guests|every guest|them)|announce|inform (all|every))\b[^.\n]{0,80}\b(ceremony|reception|room|time|is in|will be)\b/i },
  { rule: 'do-not-cite', pattern: /\b(do not|don't|never)\s+(cite|mention|include|show)\b[^.\n]{0,30}\b(source|sources|citation|citations)\b/i },
  { rule: 'assistant-address', pattern: /\b(hey|dear|attention)\s+(assistant|ai|model|claude|concierge|chatbot)\b[^.\n]{0,60}\b(must|should|need to|have to|now)\b/i },
];

export function scanForInjection(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { rule, pattern } of RULES) {
    const m = pattern.exec(text);
    if (m) findings.push({ rule, snippet: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).replace(/\s+/g, ' ').trim() });
  }
  return findings;
}

export const hasInjection = (text: string): boolean => scanForInjection(text).length > 0;
