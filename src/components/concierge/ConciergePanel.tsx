"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { decodeEvents, type ConciergeEvent } from "@/ai/events";
import type { AnswerLink, AnswerSource, ConfirmationCard } from "@/ai/types";
import { askOnDevice, isSupported, openSession, probe } from "@/lib/ai/browser-model";
import { publicEnv } from "@/lib/env.public";
import { CHAT_ROUTE, MAX_DRAFT_CHARS, MAX_QUESTION_CHARS } from "./constants";
import "./concierge.css";

/**
 * The concierge conversation (swarm J deliverable 6). A client island: the page it sits on renders
 * and is useful without it, and the FAQ above it answers the same questions with no JavaScript at
 * all. It talks to POST /api/ai/chat, which sets surface `ai` server-side; nothing here can claim a
 * surface, a principal or a tool. Only verified sentences ever arrive, so the panel renders what it
 * is given and never "types" a draft.
 */
interface Turn {
  id: string;
  role: "guest" | "concierge";
  text: string;
  sources: AnswerSource[];
  confirmations: ConfirmationCard[];
  links: AnswerLink[];
  navigate?: { route: string };
  pending: boolean;
  /** The request never completed: render nothing for this turn rather than an empty bubble. */
  failed?: boolean;
}

/** Shown when the request never reached the server (offline, dropped connection, blocked). */
/** A message the SERVER wrote for a guest (rate limit, feature off), safe to show as it stands. */
class GuestSafeError extends Error {}

export const TRANSPORT_ERROR =
  "That did not reach us — the connection dropped. Please try again; the questions on this page and the FAQ above still work.";

const STAGE_LABEL: Record<string, string> = {
  routing: "Looking for the right pages…",
  retrieving: "Reading what the site knows…",
  generating: "Writing an answer…",
  verifying: "Checking every sentence against its source…",
};

const ON_DEVICE_STAGE = "Writing an answer on your device\u2026";
/** Generation only — the model is already downloaded before this path is taken. */
const ON_DEVICE_TIMEOUT_MS = 20_000;

/**
 * Whether to answer this question on the device. Only `available` counts: a model the browser has
 * offered but not yet downloaded is worth having, but not worth making someone wait minutes for,
 * so the download is started in the background and this question goes to the server. The next one
 * is on-device.
 */
async function readyOnDevice(): Promise<boolean> {
  if (!isSupported()) return false;
  const state = await probe();
  if (state === "available") return true;
  if (state === "downloadable" || state === "downloading") {
    // Fire and forget: nothing here awaits the download, and a failure is not this turn's problem.
    void openSession().then((session) => session?.destroy?.()).catch(() => {});
  }
  return false;
}

let turnCounter = 0;
const nextTurnId = () => `t${++turnCounter}`;

/**
 * One request, one NDJSON stream, every event handed to `onEvent`. Both halves of an on-device
 * answer use this: asking for the evidence and returning the draft are the same exchange with a
 * different body. `sessionId` is a ref so the second half continues the session the first began.
 */
async function streamTurn(
  chatRoute: string,
  body: { message: string; mode?: "evidence"; draft?: string },
  sessionId: { current: string | undefined },
  onEvent: (event: ConciergeEvent) => void,
): Promise<void> {
  const response = await fetch(chatRoute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      ...(sessionId.current ? { sessionId: sessionId.current } : {}),
    }),
    credentials: "same-origin",
  });
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    // Tagged, so the catch can tell a message the SERVER wrote for a guest ("Too many
    // questions at once…") from an exception the browser threw ("Failed to fetch").
    throw new GuestSafeError(
      detail?.error?.message ?? "The concierge is unavailable right now.",
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = decodeEvents(buffer);
    buffer = rest;
    for (const e of events) onEvent(e);
  }
}

export default function ConciergePanel({
  chatRoute = CHAT_ROUTE,
}: {
  chatRoute?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const hintId = useId();

  // The button that opened the panel is replaced by the panel, so without this focus falls to
  // <body> and a keyboard or screen-reader guest has to tab back in from the top of the document.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Bring the newest turn into view. Asking pushes the input 600px down the document while the
  // scroll position stays where it was, so the answer arrived off-screen and the guest had to go
  // looking for it. `block: 'nearest'` scrolls the minimum needed and does nothing when it is
  // already visible; `prefers-reduced-motion` is respected because the default behaviour is 'auto'.
  const lastTurnRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Feature-checked, not assumed: scrolling the newest turn into view is an enhancement, and an
    // environment without `scrollIntoView` (jsdom, and any older engine) must still render a working
    // conversation rather than throw out of an effect.
    const last = lastTurnRef.current;
    if (turns.length && typeof last?.scrollIntoView === "function")
      last.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const visible = turns.filter((turn) => !turn.failed);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const asked = question.trim();
      if (asked.length < 2 || busy) return;
      const answerTurn: Turn = {
        id: nextTurnId(),
        role: "concierge",
        text: "",
        sources: [],
        confirmations: [],
        links: [],
        pending: true,
      };
      setTurns((prev) => [
        ...prev,
        {
          id: nextTurnId(),
          role: "guest",
          text: asked,
          sources: [],
          confirmations: [],
          links: [],
          pending: false,
        },
        answerTurn,
      ]);
      setQuestion("");
      setError(null);
      setBusy(true);
      setStage(STAGE_LABEL.routing!);

      const update = (patch: (turn: Turn) => Turn) =>
        setTurns((prev) =>
          prev.map((t) => (t.id === answerTurn.id ? patch(t) : t)),
        );

      try {
        // The on-device half. When the guest's browser has the Prompt API, the server is asked for
        // the evidence rather than for an answer: it still routes, still runs the tools under this
        // guest's principal and still quarantines injected sources, but the sentences are written
        // here, on their device. The draft then goes back for the same verification every answer
        // gets. Any failure at all falls through to the server writing the answer itself.
        let draft: string | null = null;
        if (publicEnv.browserModel && (await readyOnDevice())) {
          let evidence: { system: string; userTurn: string } | null = null;
          await streamTurn(
            chatRoute,
            { message: asked, mode: "evidence" },
            sessionId,
            (e) => {
              if (e.type === "evidence") evidence = { system: e.system, userTurn: e.userTurn };
              else apply(e, update, setStage, sessionId);
            },
          );
          // No evidence means the server never reached the seam — it refused, or it errored, and
          // those events have already been applied. That turn is finished; asking again would only
          // repeat it.
          if (!evidence) return;
          const { system, userTurn } = evidence;
          setStage(ON_DEVICE_STAGE);
          // A deadline, because a stalled device must not become a hung concierge. The model is
          // already downloaded by this point (`readyOnDevice`), so this bounds generation only.
          draft = await askOnDevice(userTurn, {
            systemPrompt: system,
            signal: AbortSignal.timeout(ON_DEVICE_TIMEOUT_MS),
          });
          setStage(STAGE_LABEL.verifying!);
        }
        await streamTurn(
          chatRoute,
          {
            message: asked,
            // Capped to what the route accepts; a device that rambles is truncated, not rejected.
            ...(draft ? { draft: draft.slice(0, MAX_DRAFT_CHARS) } : {}),
          },
          sessionId,
          (e) => apply(e, update, setStage, sessionId),
        );
      } catch (cause) {
        // A guest never sees `cause.message` from an exception: a dropped connection rendered the
        // browser's own "Failed to fetch" into the panel. A message the server wrote IS for them —
        // the rate limit and the feature-off notice both arrive as a non-200 body — so those are
        // passed through and anything else becomes the one honest sentence about a failed request.
        setError(
          cause instanceof GuestSafeError ? cause.message : TRANSPORT_ERROR,
        );
        update((t) => ({ ...t, pending: false, failed: true }));
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
      {/* `role="log"` sits on the WRAPPER, not on the <ol>. An explicit role replaces an element's
          implicit one, so putting it on the list itself stopped the list being a list and axe
          reported both turns as `listitem` violations — orphaned <li>s. The live region and the
          list are two jobs; they get two elements. */}
      {visible.length > 0 ? (
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation with the concierge"
        >
          <ol className="cq__log">
            {visible.map((turn, index) => (
              <li
                key={turn.id}
                ref={index === visible.length - 1 ? lastTurnRef : undefined}
                className={`cq__turn cq__turn--${turn.role === "guest" ? "guest" : "concierge"}`}
              >
                <span className="cq__who">
                  {turn.role === "guest" ? "You asked" : "The concierge"}
                </span>
                <div className="cq__bubble">
                  {turn.text ? (
                    <p>{turn.text}</p>
                  ) : turn.pending ? (
                    <p className="cq__meta">Working on it…</p>
                  ) : null}
                  {turn.sources.length > 0 ? (
                    <>
                      <p className="cq__meta">Based on:</p>
                      <ol className="cq__sources">
                        {turn.sources.map((source) => (
                          <li key={source.marker}>
                            <span aria-hidden="true">[{source.marker}] </span>
                            {source.url ? (
                              <a
                                href={source.url}
                                {...(source.url.startsWith("http")
                                  ? {
                                      target: "_blank",
                                      rel: "noopener noreferrer external",
                                    }
                                  : {})}
                              >
                                {source.title}
                              </a>
                            ) : (
                              source.title
                            )}
                            {source.verifiedAt ? (
                              <span className="cq__meta">
                                {" "}
                                · checked {source.verifiedAt.slice(0, 10)}
                              </span>
                            ) : null}
                            {source.trustClass === "EXTERNAL_DATA" ? (
                              <span className="cq__meta"> · live data</span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : null}
                  {turn.links.length > 0 ? (
                    <>
                      {/* Its own class and a VISIBLE lead-in. This list is "where to go instead", not
                        "where this came from", and sharing `.cq__sources` with the citations left a
                        sighted guest two identical lists whose meanings differed only in an
                        aria-label they could not see. */}
                      <p className="cq__meta">Where to look next:</p>
                      <ul className="cq__links">
                        {turn.links.map((link) => (
                          <li key={link.href}>
                            <a href={link.href}>{link.label}</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {turn.confirmations.map((card) => (
                    <div
                      className="cq__card"
                      key={card.capability}
                      role="group"
                      aria-label={`Confirm on the website: ${card.title}`}
                    >
                      <h4>{card.title}</h4>
                      <p>{card.summary}</p>
                      <p>
                        <a
                          className="cq__button cq__button--quiet"
                          href={card.reviewRoute}
                        >
                          Review and confirm on the website
                        </a>
                      </p>
                    </div>
                  ))}
                  {turn.navigate ? (
                    <p>
                      <a href={turn.navigate.route}>
                        Open {turn.navigate.route}
                      </a>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="cq__meta" aria-live="polite" data-testid="concierge-status">
        {stage ?? ""}
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
        {/* A textarea, not a single-line input: the invitation says "in your own words" and the
            field was 209px wide in the narrower design, showing a fraction of what had been typed.
            Enter still submits, so the one-line habit is unchanged; Shift+Enter starts a line. */}
        <textarea
          id={inputId}
          ref={inputRef}
          className="cq__input"
          name="message"
          rows={2}
          value={question}
          onChange={(e) =>
            setQuestion(e.target.value.slice(0, MAX_QUESTION_CHARS))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          maxLength={MAX_QUESTION_CHARS}
          minLength={2}
          aria-describedby={hintId}
          autoComplete="off"
          data-testid="concierge-input"
        />
        {/* Enabled even when the field is empty: a disabled button leaves the tab order, so Tab
            from an empty input skipped the primary action and left the panel entirely. `submit`
            already ignores a question shorter than two characters. */}
        <button
          className="cq__button"
          type="submit"
          aria-disabled={busy || question.trim().length < 2}
          data-testid="concierge-send"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
        <p className="cq__hint" id={hintId}>
          Answers come only from this site, with a source for every sentence. If
          we have not decided something yet, the concierge says so instead of
          guessing. It cannot book, submit, or change anything.
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
    case "session":
      sessionId.current = event.sessionId;
      return;
    case "status":
      setStage(STAGE_LABEL[event.stage] ?? null);
      return;
    case "text":
      update((t) => ({
        ...t,
        text: t.text ? `${t.text} ${event.text}` : event.text,
      }));
      return;
    case "sources":
      update((t) => ({ ...t, sources: event.sources }));
      return;
    case "confirmation":
      update((t) => ({
        ...t,
        confirmations: [...t.confirmations, event.card],
      }));
      return;
    case "navigate":
      update((t) => ({ ...t, navigate: { route: event.route } }));
      return;
    case "refusal":
      update((t) => ({
        ...t,
        text: event.message,
        links: event.links,
        pending: false,
      }));
      return;
    case "error":
      update((t) => ({ ...t, text: event.message, pending: false }));
      return;
    case "done":
      update((t) => ({ ...t, pending: false }));
      setStage(null);
      return;
  }
}
