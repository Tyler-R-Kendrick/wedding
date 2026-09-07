import type { AiAnswerStatus } from '@/db/schema/ai';
import type { AnswerLink, AnswerSource, ConfirmationCard } from './types';

/**
 * Newline-delimited JSON events streamed by POST /api/ai/chat. Only verified sentences are ever
 * sent as `text`; the guest never sees an unverified draft (ADR-0003 rule 4/5).
 */
export type ConciergeEvent =
  | { type: 'session'; sessionId: string; answerId: string }
  | { type: 'status'; stage: 'routing' | 'retrieving' | 'generating' | 'verifying'; tools?: string[] }
  | { type: 'text'; text: string }
  | { type: 'sources'; sources: AnswerSource[] }
  | { type: 'confirmation'; card: ConfirmationCard }
  | { type: 'navigate'; route: string; highlight?: string }
  | { type: 'refusal'; message: string; links: AnswerLink[] }
  | { type: 'done'; status: AiAnswerStatus; dropped: number; latencyMs: number }
  | { type: 'error'; code: string; message: string };

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

export function encodeEvent(event: ConciergeEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Parses one NDJSON chunk boundary-safely; returns complete events and the unread remainder. */
export function decodeEvents(buffer: string): { events: ConciergeEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: ConciergeEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ConciergeEvent);
    } catch {
      // a malformed line is dropped; the stream stays usable
    }
  }
  return { events, rest };
}
