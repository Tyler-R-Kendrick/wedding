'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AssistantAnswer } from '@/capabilities/ops/admin_assistant';
import { callCapability } from '@/components/handoff/client';
import { AdminIcon } from '@/components/admin/shell/icons';
import { VIEWS } from '@/domain/admin-assistant/catalog';
import { acceptSaid, choosePrompt, parseChoice, sayPrompt } from '@/domain/admin-assistant/writer';
import { askOnDevice, probe, warm, type BrowserModelState } from '@/lib/ai/browser-model';
import { AssistantHostProvider, defaultHost, type AssistantHost } from './openui/host';
import { AdminRenderer } from './openui/library';
import './assistant.css';

/**
 * The console's assistant: a question in, a small dashboard out.
 *
 * Each turn is one call to `admin_assistant_answer`, which reads this site's own records for the
 * signed-in administrator and returns an OpenUI Lang program; `AdminRenderer` draws it, keeps its
 * queries live, and hands follow-up questions and confirmed changes back here. The browser's
 * built-in model is used when the device has one, for two things only: choosing a view for a
 * question the router could not read, and putting the answer in a sentence — both checked
 * (domain/admin-assistant/writer.ts). Without it every answer still arrives, in the composer's
 * own words. Nothing is sent to a hosted model.
 */

type Choice = { view?: AssistantAnswer['view']; window?: 24 | 168 | 720; subject?: string; sessionId?: string };
type Turn = { id: string; question: string; status: 'reading' | 'done' | 'failed'; answer?: AssistantAnswer; said?: string; error?: string; choice?: Choice };

const STORE = 'admin-assistant:v1';
const KEEP = 8;
const STARTERS = VIEWS.filter((v) => ['attention', 'rsvp', 'traffic', 'errors', 'pending', 'lifecycle'].includes(v.name)).map((v) => v.example);

const withTimeout = <T,>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return work(controller.signal)
    .catch(() => null)
    .finally(() => clearTimeout(timer));
};

function load(): Turn[] {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    const turns = raw ? (JSON.parse(raw) as Turn[]) : [];
    return Array.isArray(turns) ? turns.filter((t) => t && t.status === 'done' && t.answer).slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function Assistant({ initialQuestion }: { initialQuestion?: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState<BrowserModelState>('unsupported');
  const [restored, setRestored] = useState(false);
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const modelRef = useRef<BrowserModelState>('unsupported');
  const busy = turns.some((t) => t.status === 'reading');

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the thread lives in sessionStorage, readable only after hydration */
    setTurns(load());
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void probe().then((state) => {
      modelRef.current = state;
      setModel(state);
      if (state === 'available') warm();
    });
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(STORE, JSON.stringify(turns.filter((t) => t.status === 'done').slice(-KEEP)));
    } catch {
      // A full or disabled store only costs the thread on reload.
    }
  }, [turns, restored]);

  const patch = useCallback((id: string, change: Partial<Turn>) => setTurns((all) => all.map((t) => (t.id === id ? { ...t, ...change } : t))), []);

  const fetchAnswer = useCallback(async (question: string, choice?: Choice) => callCapability<AssistantAnswer>('admin_assistant_answer', { input: { message: question, ...(choice && Object.keys(choice).length ? { choice } : {}) } }), []);

  /** Put the answer in a sentence on the device, when it has a model; keep it only if it checks out. */
  const say = useCallback(
    async (id: string, question: string, answer: AssistantAnswer) => {
      if (modelRef.current !== 'available' || answer.facts.length === 0) return;
      const { system, prompt } = sayPrompt(question, answer);
      const said = acceptSaid(await withTimeout((signal) => askOnDevice(prompt, { systemPrompt: system, signal }), 12_000), answer);
      if (said) patch(id, { said });
    },
    [patch],
  );

  const ask = useCallback(
    async (raw: string, given?: Choice) => {
      const question = raw.trim().slice(0, 500);
      if (!question) return;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setTurns((all) => [...all.slice(-(KEEP - 1)), { id, question, status: 'reading', ...(given ? { choice: given } : {}) }]);
      setDraft('');
      let choice = given;
      let res = await fetchAnswer(question, choice);
      // The router could not read it: a device with a model is asked which view it means.
      if (res.ok && res.data && !res.data.understood && modelRef.current === 'available') {
        const { system, prompt } = choosePrompt(question);
        const picked = parseChoice(await withTimeout((signal) => askOnDevice(prompt, { systemPrompt: system, signal }), 10_000));
        if (picked?.view) {
          choice = { view: picked.view, ...(picked.window ? { window: picked.window as Choice['window'] } : {}), ...(picked.subject ? { subject: picked.subject } : {}) };
          const second = await fetchAnswer(question, choice);
          if (second.ok && second.data) res = second;
        }
      }
      if (!res.ok || !res.data) {
        if (res.error?.code === 'unauthenticated') return router.push('/sign-in/admin?next=/admin/assistant');
        return patch(id, { status: 'failed', error: res.error?.message ?? 'That could not be answered. Try again in a moment.' });
      }
      patch(id, { status: 'done', answer: res.data, ...(choice ? { choice } : {}) });
      void say(id, question, res.data);
    },
    [fetchAnswer, patch, router, say],
  );

  /** The window control moved: the figures refresh in place, and the words above them catch up. */
  const rewindow = useCallback(
    async (turn: Turn, hours: number) => {
      if (!turn.answer || turn.answer.window === hours || ![24, 168, 720].includes(hours)) return;
      const choice: Choice = { ...turn.choice, view: turn.answer.view, window: hours as Choice['window'] };
      const res = await fetchAnswer(turn.question, choice);
      if (!res.ok || !res.data) return;
      // The program on screen already shows the new window; only the words and facts are replaced.
      patch(turn.id, { answer: { ...res.data, program: turn.answer.program }, said: undefined, choice });
      void say(turn.id, turn.question, res.data);
    },
    [fetchAnswer, patch, say],
  );

  // A question handed over by the palette or the overview (`?q=`), asked once.
  useEffect(() => {
    if (!restored || asked.current || !initialQuestion?.trim()) return;
    asked.current = true;
    void ask(initialQuestion);
    router.replace('/admin/assistant');
  }, [restored, initialQuestion, ask, router]);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ block: 'end', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [turns.length, busy]);

  const host = useMemo<AssistantHost>(() => ({ ...defaultHost, changed: () => router.refresh() }), [router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void ask(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) void ask(draft);
    }
  };

  const empty = restored && turns.length === 0;

  return (
    <AssistantHostProvider host={host}>
      <div className="ask">
        <div className="ask__thread" aria-live="polite" aria-busy={busy}>
          {empty ? (
            <div className="ask-start">
              <h2 className="ask-start__title">What do you need to know?</h2>
              <p className="ask-start__lede">Answers are read from this site’s own records, as your role allows. A change is proposed for you to confirm, never made for you.</p>
              <ul className="ask-start__list">
                {STARTERS.map((q) => (
                  <li key={q}>
                    <button type="button" className="ask-start__q" onClick={() => void ask(q)}>
                      <span>{q}</span>
                      <AdminIcon name="arrow" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {turns.map((turn) => (
            <article key={turn.id} className="ask-turn" aria-label={`Answer to: ${turn.question}`}>
              <p className="ask-turn__q">
                <span className="sr-only">You asked: </span>
                {turn.question}
              </p>
              {turn.status === 'reading' ? (
                <div className="ask-wait" role="status">
                  <span className="sr-only">Reading the records</span>
                  <span className="ask-wait__bar" />
                  <span className="ask-wait__bar" />
                  <span className="ask-wait__bar" />
                </div>
              ) : turn.status === 'failed' ? (
                <p className="ask-turn__error" role="alert">
                  {turn.error}{' '}
                  <button type="button" className="aui-link" onClick={() => void ask(turn.question, turn.choice)}>
                    Ask again
                  </button>
                </p>
              ) : turn.answer ? (
                <div className="ask-answer">
                  <header className="ask-answer__head">
                    <h2 className="ask-answer__title">{turn.answer.title}</h2>
                    <p className="ask-answer__summary">{turn.said ?? turn.answer.summary}</p>
                  </header>
                  <AdminRenderer
                    response={turn.answer.program}
                    onAsk={(message) => void ask(message)}
                    onStateUpdate={(state) => {
                      const hours = Number((state as Record<string, unknown>).$window ?? (state as Record<string, unknown>).window);
                      if (Number.isFinite(hours)) void rewindow(turn, hours);
                    }}
                  />
                  {turn.answer.read.length ? (
                    <details className="ask-trace">
                      <summary>How this was answered</summary>
                      <ul>
                        {turn.answer.read.map((r, i) => (
                          <li key={`${r.tool}-${i}`}>
                            {r.ok ? 'Read' : 'Not part of your access'}: {r.title}
                          </li>
                        ))}
                        <li>{turn.said ? 'Worded on this device by the browser’s built-in model, checked against the figures above.' : 'Worded by the site, from the figures above. No model was used.'}</li>
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
          <div ref={end} />
        </div>

        <form className="ask-box" onSubmit={submit}>
          <div className="ask-box__head">
            <label htmlFor={fieldId} className="ask-box__label">
              Ask the console
            </label>
            <p className="ask-box__note">
              <span className="ask-box__how">{model === 'available' ? 'Worded on this device by the browser’s built-in model.' : 'Answered from the site’s own records. No AI model in this browser.'}</span>
              {turns.length ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="aui-link"
                    onClick={() => {
                      setTurns([]);
                      field.current?.focus();
                    }}
                  >
                    Clear
                  </button>
                </>
              ) : null}
            </p>
          </div>
          <div className="ask-box__row">
            <textarea ref={field} id={fieldId} className="ask-box__field" rows={1} maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} enterKeyHint="send" autoComplete="off" />
            <button type="submit" className="ask-box__send" aria-disabled={busy || !draft.trim() || undefined} aria-label={busy ? 'Reading the records' : 'Ask'}>
              <AdminIcon name={busy ? 'stop' : 'send'} />
            </button>
          </div>
        </form>
      </div>
    </AssistantHostProvider>
  );
}
