'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { decodeEvents, type ConciergeEvent } from '@/ai/events';
import type { AnswerLink, AnswerSource, ConfirmationCard } from '@/ai/types';
import { CHAT_ROUTE, MAX_QUESTION_CHARS } from './constants';
import './concierge.css';

/**
 * The concierge conversation (swarm J deliverable 6). A client island: the page it sits on renders
 * and is useful without it, and the FAQ above it answers the same questions with no JavaScript at
 * all. It talks to POST /api/ai/chat, which sets surface `ai` server-side; nothing here can claim a
 * surface, a principal or a tool. Only verified sentences ever arrive, so the panel renders what it
 * is given and never "types" a draft.
 */
interface Turn {
  id: string;
  role: 'guest' | 'concierge';
  text: string;
  sources: AnswerSource[];
  confirmations: ConfirmationCard[];
  links: AnswerLink[];
  navigate?: { route: string };
  pending: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  routing: 'Looking for the right pages…',
  retrieving: 'Reading what the site knows…',
  generating: 'Writing an answer…',
  verifying: 'Checking every sentence against its source…',
};

let turnCounter = 0;
const nextTurnId = () => `t${++turnCounter}`;

export default function ConciergePanel({ chatRoute = CHAT_ROUTE }: { chatRoute?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const inputId = useId();
  const hintId = useId();

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const asked = question.trim();
      if (asked.length < 2 || busy) return;
      const answerTurn: Turn = { id: nextTurnId(), role: 'concierge', text: '', sources: [], confirmations: [], links: [], pending: true };
      setTurns((prev) => [...prev, { id: nextTurnId(), role: 'guest', text: asked, sources: [], confirmations: [], links: [], pending: false }, answerTurn]);
      setQuestion('');
      setError(null);
      setBusy(true);
      setStage(STAGE_LABEL.routing!);

      const update = (patch: (turn: Turn) => Turn) => setTurns((prev) => prev.map((t) => (t.id === answerTurn.id ? patch(t) : t)));

      try {
        const response = await fetch(chatRoute, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: asked, ...(sessionId.current ? { sessionId: sessionId.current } : {}) }),
          credentials: 'same-origin',
        });
        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
          throw new Error(detail?.error?.message ?? 'The concierge is unavailable right now.');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = decodeEvents(buffer);
          buffer = rest;
          for (const e of events) apply(e, update, setStage, sessionId);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The concierge is unavailable right now.');
        update((t) => ({ ...t, pending: false }));
      } finally {
        setBusy(false);
        setStage(null);
        update((t) => ({ ...t, pending: false }));
      }
    },
    [busy, chatRoute, question],
  );

  return (
    <div className="cq" data-testid="concierge">
      <ol className="cq__log" aria-label="Conversation with the concierge">
        {turns.map((turn) => (
          <li key={turn.id} className={`cq__turn cq__turn--${turn.role === 'guest' ? 'guest' : 'concierge'}`}>
            <span className="cq__who">{turn.role === 'guest' ? 'You asked' : 'The concierge'}</span>
            <div className="cq__bubble">
              {turn.text ? <p>{turn.text}</p> : turn.pending ? <p className="cq__meta">Working on it…</p> : null}
              {turn.sources.length > 0 ? (
                <>
                  <p className="cq__meta">Based on:</p>
                  <ol className="cq__sources">
                    {turn.sources.map((source) => (
                      <li key={source.marker}>
                        <span aria-hidden="true">[{source.marker}] </span>
                        {source.url ? (
                          <a href={source.url} {...(source.url.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer external' } : {})}>
                            {source.title}
                          </a>
                        ) : (
                          source.title
                        )}
                        {source.verifiedAt ? <span className="cq__meta"> · checked {source.verifiedAt.slice(0, 10)}</span> : null}
                        {source.trustClass === 'EXTERNAL_DATA' ? <span className="cq__meta"> · live data</span> : null}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {turn.links.length > 0 ? (
                <ul className="cq__sources" aria-label="Where to look next">
                  {turn.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
              {turn.confirmations.map((card) => (
                <div className="cq__card" key={card.capability} role="group" aria-label={`Confirm on the website: ${card.title}`}>
                  <h4>{card.title}</h4>
                  <p>{card.summary}</p>
                  <p>
                    <a className="cq__button cq__button--quiet" href={card.reviewRoute}>
                      Review and confirm on the website
                    </a>
                  </p>
                </div>
              ))}
              {turn.navigate ? (
                <p>
                  <a href={turn.navigate.route}>Open {turn.navigate.route}</a>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <p className="cq__meta" aria-live="polite" data-testid="concierge-status">
        {stage ?? ''}
      </p>
      {error ? (
        <p className="cq__error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="cq__form" onSubmit={submit}>
        <label className="cq__label" htmlFor={inputId}>
          Ask about the wedding
        </label>
        <input
          id={inputId}
          className="cq__input"
          name="message"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))}
          maxLength={MAX_QUESTION_CHARS}
          minLength={2}
          aria-describedby={hintId}
          autoComplete="off"
          data-testid="concierge-input"
        />
        <button className="cq__button" type="submit" disabled={busy || question.trim().length < 2} data-testid="concierge-send">
          {busy ? 'Asking…' : 'Ask'}
        </button>
        <p className="cq__hint" id={hintId}>
          Answers come only from this site, with a source for every sentence. If we have not decided something yet, the concierge says so instead of guessing. It cannot book, submit, or change anything.
        </p>
      </form>
    </div>
  );
}

function apply(
  event: ConciergeEvent,
  update: (patch: (turn: Turn) => Turn) => void,
  setStage: (stage: string | null) => void,
  sessionId: { current: string | undefined },
): void {
  switch (event.type) {
    case 'session':
      sessionId.current = event.sessionId;
      return;
    case 'status':
      setStage(STAGE_LABEL[event.stage] ?? null);
      return;
    case 'text':
      update((t) => ({ ...t, text: t.text ? `${t.text} ${event.text}` : event.text }));
      return;
    case 'sources':
      update((t) => ({ ...t, sources: event.sources }));
      return;
    case 'confirmation':
      update((t) => ({ ...t, confirmations: [...t.confirmations, event.card] }));
      return;
    case 'navigate':
      update((t) => ({ ...t, navigate: { route: event.route } }));
      return;
    case 'refusal':
      update((t) => ({ ...t, text: event.message, links: event.links, pending: false }));
      return;
    case 'error':
      update((t) => ({ ...t, text: event.message, pending: false }));
      return;
    case 'done':
      update((t) => ({ ...t, pending: false }));
      setStage(null);
      return;
  }
}
