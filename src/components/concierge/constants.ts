/** Shared by the panel, the page that mounts it, and the tests. No client bundle is pulled in. */
export const CHAT_ROUTE = '/api/ai/chat';
export const MAX_QUESTION_CHARS = 2000;

/**
 * The transcript is capped at this many rendered turns (question + answer = two turns), oldest
 * dropped first.
 *
 * It was unbounded. Every turn keeps its own text, its sources, its confirmation cards and its
 * links, all inside one `role="log"` live region — so a long session on a phone grew the DOM
 * without limit, and `aria-relevant="additions text"` means a screen reader is walking a list that
 * never stops growing. Nothing here is server state: the session id is what carries context to
 * /api/ai/chat, so dropping an old turn from the view costs the guest no memory in the answer.
 * 12 keeps six exchanges, which is more than the longest eval case and more than a phone shows.
 */
export const MAX_TRANSCRIPT_TURNS = 12;
