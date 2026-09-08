/**
 * Every decision the Secret Drop page makes about a slot, as pure functions.
 *
 * This lives outside the template because it is the part that can be wrong in ways nobody sees:
 * which provider is selected, which ceremony that implies, whether a control should be offered at
 * all. It got that wrong — a status computed for the *previously* chosen provider kept deciding the
 * ceremony after the choice changed, so picking Postmark (sign in) still offered Resend's "Get the
 * link" — and no test could have caught it, because the logic only existed inside an HTML string.
 *
 * `build-page.mjs` inlines this into the page (the artifact is one self-contained file, no build
 * step and no imports at runtime), and the tests import it directly. Same code, both places.
 */

/**
 * Bind the decisions to a client registry (`clientRegistry()` from registry.mjs, or `REG` in the
 * page). Everything below is pure: same inputs, same answer, no DOM and no clock except the `now`
 * that is passed in.
 */
export function createLogic(reg) {
  const CEREMONY = reg.ceremony;
  const METHOD_CEREMONY = reg.methodCeremony;

  /**
   * How long a request may sit before the page stops calling it pending.
   *
   * Nothing may queue forever. `secrets:serve` claims a hand-off in well under a second; a Claude
   * session acting as courier takes seconds, not minutes. Past this the honest word is not
   * "queued" but "nothing picked this up", and the strip has to offer a route that does not
   * depend on anyone else being awake.
   */
  const CLAIM_DEADLINE_MS = 45_000;

  /** The provider in force: what was chosen, else the recommended one, else the first. */
  function optionFor(slot, choices = {}) {
    return slot.options.find((o) => o.id === choices[slot.id])
      || slot.options.find((o) => o.recommended)
      || slot.options[0];
  }

  /**
   * The acquisition status, but only when it describes the provider actually selected.
   *
   * `.secrets/outbox.json` records which option each run was for. Switching provider does not
   * re-run the ladder, so the old row survives — and trusting its `nextAction` is what made a
   * sign-in provider keep offering an OAuth link. A status for another option tells us nothing
   * about this one.
   */
  function statusFor(slot, status = {}, choices = {}) {
    const row = status[slot.id];
    if (!row) return null;
    const chosen = optionFor(slot, choices);
    if (row.option && row.option !== chosen.id) return null;
    return row;
  }

  /** Where a slot has got to. Unknown, or known only for a provider no longer chosen, is queued. */
  function stateOf(slot, status = {}, choices = {}) {
    const opt = optionFor(slot, choices);
    if (opt.isOptOut) return 'skipped';
    const row = statusFor(slot, status, choices);
    if (!row) return 'queued';
    if (row.state === 'live') return 'working';
    if (row.state === 'acquired' || row.state === 'already-set') return 'connected';
    if (row.state === 'rejected' || row.state === 'failed') return 'fault';
    if (row.state === 'skipped') return 'skipped';
    return 'queued';
  }

  /**
   * The ceremony this slot is asking of a person right now: the rung the ladder actually stopped
   * on when that rung is known for *this* provider, otherwise what the provider implies.
   */
  function ceremonyIdFor(slot, status = {}, choices = {}) {
    const opt = optionFor(slot, choices);
    const live = statusFor(slot, status, choices)?.nextAction?.method;
    return (live && METHOD_CEREMONY[live]) || opt.ceremony;
  }

  /** The ceremony record, for label and `asksYou`. */
  function ceremonyOf(slot, status = {}, choices = {}) {
    return CEREMONY[ceremonyIdFor(slot, status, choices)] || CEREMONY.paste;
  }

  /** A slot is the person's problem only when its ceremony needs a human and it is not done. */
  function needsYou(slot, status = {}, choices = {}) {
    const st = stateOf(slot, status, choices);
    if (st === 'connected' || st === 'working' || st === 'skipped') return false;
    if (st === 'fault') return true;
    // Tooling is for us, never for the wedding — it waits below until someone asks for it.
    if (slot.need === 'tooling' && !choices[slot.id]) return false;
    return ceremonyOf(slot, status, choices).asksYou === true;
  }

  /**
   * Which provider a ceremony or hand-off was started for.
   *
   * Newer records carry `option` outright. Older ones do not, but the status row was written by
   * the same ladder run, so it names the same provider. Only when neither says is the owner
   * unknown — and an unknown owner is not held against the record.
   */
  function ownerOf(record, slot, status = {}) {
    return record?.option ?? status[slot.id]?.option ?? null;
  }

  /**
   * Whether a record still describes the provider in force. A Resend OAuth link is not an answer
   * to "I picked Postmark", and offering it as one is how choosing a provider came to do nothing
   * visible: the ceremony was found first and answered for a provider nobody had selected.
   */
  function stillChosen(record, slot, status = {}, choices = {}) {
    const owner = ownerOf(record, slot, status);
    return owner === null || owner === optionFor(slot, choices).id;
  }

  /**
   * An authorization link has a deadline. Past it the provider rejects the code, so offering
   * "Approve" sends someone to a page that cannot work — the artifact was holding four links that
   * had expired the previous evening.
   */
  function expired(ceremony, now = Date.now()) {
    // A failure has no deadline. Hiding it once the link lapsed is how a failed exchange came back
    // as a fresh "Approve" with nothing saying the last one could not be redeemed.
    if (ceremony?.status === 'failed') return false;
    const at = Date.parse(ceremony?.expiresAt ?? '');
    return Number.isFinite(at) && at <= now;
  }

  /**
   * A ceremony you can still act on, versus one already answered. `code-received` means the code
   * came back and is being exchanged: offering "Approve" again there sends someone to approve a
   * thing they have already approved. Ceremonies belonging to a provider no longer chosen are not
   * actionable at all — they are somebody else's unfinished business.
   */
  function ceremonyState(slot, ceremonies = [], status = {}, choices = {}, now = Date.now()) {
    const id = typeof slot === 'string' ? slot : slot.id;
    const shaped = typeof slot === 'string' ? { id, options: [] } : slot;
    const mine = ceremonies.filter((c) => c.credential === id
      && stillChosen(c, shaped, status, choices)
      && !expired(c, now));
    const SETTLING = ['code-received', 'exchanging', 'running', 'failed'];
    return {
      open: mine.find((c) => c.status === 'waiting' || !c.status) || null,
      settling: mine.find((c) => SETTLING.includes(c.status)) || null,
    };
  }

  /**
   * What is happening to an approved link, in the same four states as a hand-off.
   *
   * The page used to say "Approved just now — finishing up" from the moment the code came back,
   * for ever. Nothing was finishing it up: `code-received` had one writer and no reader, exactly
   * like hand-offs did. `queued` is the honest word for a code nobody has exchanged yet.
   */
  function settleOf(ceremony) {
    if (!ceremony) return null;
    // Two words for the same thing: `exchanging` is what the ladder writes, `running` is what the
    // local server writes when it spawns the exchange. Reading only one of them showed live work
    // as "nothing has finished this yet" — the frozen sentence again, in a new spelling.
    const state = (ceremony.status === 'exchanging' || ceremony.status === 'running') ? 'running'
      : ceremony.status === 'failed' ? 'failed'
      : 'queued';
    return {
      state,
      since: state === 'running'
        ? (ceremony.exchangeStartedAt || ceremony.receivedAt || ceremony.openedAt)
        : (ceremony.finishedAt || ceremony.receivedAt || ceremony.openedAt || ceremony.startedAt),
      detail: state === 'queued' ? null : (ceremony.detail || null),
      // A spent code cannot be exchanged twice, so the way back is a fresh link, not a re-try.
      canRetry: state === 'failed',
    };
  }

  /** A hand-off for this provider that still has something to say. */
  function askedFor(slot, handoffs = {}, status = {}, choices = {}) {
    const id = typeof slot === 'string' ? slot : slot.id;
    const shaped = typeof slot === 'string' ? { id, options: [] } : slot;
    const h = handoffs[id];
    if (!h || h.status === 'cancelled' || h.status === 'done') return null;
    return stillChosen(h, shaped, status, choices) ? h : null;
  }

  /**
   * What is actually happening to a hand-off, in the terms a person needs.
   *
   * The page used to say "Claude is on it" the moment the request was written, for ever, whatever
   * happened next — including when nothing happened next, which was every time, because nothing
   * consumed hand-offs at all. These four states are the ones that can be true, and each is
   * distinguishable on the page: nobody has started (`queued`), something is doing it (`running`),
   * it worked (`done`), it did not (`failed`, with a reason).
   */
  function workOf(handoff, now = Date.now()) {
    if (!handoff) return null;
    const asked = Date.parse(handoff.requestedAt ?? '');
    // Queued is a promise that something is coming. Past the deadline nothing is, and saying so
    // is the whole point: this is where "Asked just now" used to sit for ever.
    const stale = Number.isFinite(asked) && now - asked > CLAIM_DEADLINE_MS;
    const state = handoff.status === 'running' ? 'running'
      : handoff.status === 'failed' ? 'failed'
      : handoff.status === 'done' ? 'done'
      : stale ? 'unclaimed'
      : 'queued';
    return {
      state,
      kind: handoff.kind || 'signin',
      host: handoff.host || null,
      // `running` is timed from when the work started, not from when it was asked for.
      since: state === 'running' ? (handoff.startedAt || handoff.requestedAt) : handoff.requestedAt,
      // The last thing the work said. Absent until something has said anything.
      detail: (state === 'queued' || state === 'unclaimed') ? null : (handoff.detail || null),
      progressAt: handoff.progressAt || null,
      log: handoff.log || '',
      canRetry: state === 'failed' || state === 'queued' || state === 'unclaimed',
    };
  }

  /**
   * The single control a strip should offer, if any.
   *
   * `home` is load-bearing, not decoration. The published artifact is a page with its own origin
   * and NOTHING behind it: no server, and no guarantee a Claude session is watching. Offering it
   * "Sign in once" wrote a request that nothing would ever claim — a queue with no consumer, which
   * is indistinguishable on screen from work in progress. So a home may only offer a route it can
   * carry to an end:
   *
   *   local     a worker is behind the page, so a press may dispatch a job.
   *   artifact  only what the page itself can do (a ceremony the provider lets a browser run) or
   *             what the person at the keyboard can do (their own key page, and a field).
   *   disk      no store at all: everything ends in a sealed bundle to paste.
   *
   * `dispatch` is therefore the only kind that queues, and it exists only where something claims it.
   */
  function actionFor(slot, { status = {}, choices = {}, ceremonies = [], handoffs = {}, home = 'artifact', now = Date.now() } = {}) {
    const opt = optionFor(slot, choices);
    const { open, settling } = ceremonyState(slot, ceremonies, status, choices, now);
    if (settling) return { kind: 'settling', ceremony: settling, work: settleOf(settling) };
    if (open) return { kind: 'approve', ceremony: open, reopened: Boolean(open.openedAt) };

    // Work already dispatched outranks offering to dispatch it again — but only while it is
    // really moving. An unclaimed request is reported by the strip, not treated as progress.
    const asked = askedFor(slot, handoffs, status, choices);
    const work = workOf(asked, now);
    if (asked && work.state !== 'unclaimed') return { kind: 'asked', handoff: asked, work };

    const cer = ceremonyIdFor(slot, status, choices);
    const stalled = asked ? { handoff: asked, work } : null;

    if (cer === 'signin' || cer === 'link') {
      // A worker is behind this page, so asking it to do the work is a real thing to press.
      if (home === 'local') return { kind: 'dispatch', option: opt, handoffKind: cer, stalled };
      // The provider lets a browser register and exchange, so the page can run the whole ceremony.
      if (cer === 'link' && opt.browserAuth) return { kind: 'authorize', option: opt, stalled };
      // Nothing here can do it, so the person can: their own key page, and a field beside it.
      if (opt.keysUrl) return { kind: 'selfServe', option: opt, url: opt.keysUrl, stalled };
      return { kind: 'none', option: opt, stalled };
    }
    if (cer === 'apply' && opt.host) return { kind: 'apply', option: opt, stalled };
    return { kind: 'none', option: opt, stalled };
  }

  /**
   * Whether the quiet "enter it myself" escape belongs on this strip.
   *
   * Not when the strip already offers the field. A `paste` ceremony shows its fields inline, and
   * a `selfServe` control comes with "paste it here" beside the provider's key page — offering
   * "enter it myself" as well is two buttons doing the identical thing, and the second one reads
   * as a different route that turns out not to be one.
   */
  function allowsManualEntry(slot, status = {}, choices = {}, home = 'artifact') {
    const opt = optionFor(slot, choices);
    if (opt.secrets.length === 0) return false;
    if (ceremonyIdFor(slot, status, choices) === 'paste') return false;
    return actionFor(slot, { status, choices, home }).kind !== 'selfServe';
  }

  /** Fields shown inline, because nothing can obtain this on anyone's behalf. */
  function pasteFields(slot, status = {}, choices = {}) {
    const opt = optionFor(slot, choices);
    return ceremonyIdFor(slot, status, choices) === 'paste' ? opt.secrets : [];
  }

  /** What a connected row says it holds, and which rung produced it. */
  function boundSummary(slot, status = {}, choices = {}) {
    const row = statusFor(slot, status, choices);
    if (!row || stateOf(slot, status, choices) !== 'connected') return null;
    const how = {
      authmd: 'registered', register: 'registered', oauth: 'you approved a link',
      device: 'you approved a link', browser: 'you signed in', harness: 'borrowed a session',
      manual: 'you provided it', generate: 'generated', derive: 'derived',
      detect: 'already set', mcp: 'via MCP',
    }[row.method];
    const held = Number.isFinite(row.of) && row.of > 0 ? `${row.set ?? row.of}/${row.of} held` : null;
    const parts = [held, how].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  return {
    optionFor, statusFor, stateOf, ceremonyIdFor, ceremonyOf, needsYou, ownerOf, stillChosen, expired,
    ceremonyState, askedFor, workOf, settleOf, actionFor, allowsManualEntry, pasteFields, boundSummary,
  };
}

/** "just now" / "4 min ago" / "2 h ago" — enough to tell a fresh ask from a stuck one. */
export function ago(iso, now = Date.now()) {
  const then = Date.parse(iso || '');
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}
