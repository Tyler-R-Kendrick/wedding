# Design review — src/components/concierge/ConciergePanel.tsx (route /ask-us) — 2026-09-07

Branch `claude/secret-drop-artifact-improve-wshn0k`, commits `139d630` (evidence mode)
and `ccc950a` (download gate). Behaviour-only change: no new DOM, no new CSS.

## Verdict: FIX FIRST
Scores (1–10): Design **8** · Usability **5** · Creativity **9** · Content **6**
(Ship threshold: all ≥ 7 and Usability ≥ 8 — wedding-site-standards §5)

Usability fails on the live-region contract, and Content fails on stage-string honesty.
Everything deterministic is green: detector 0, design:lint 0, axe 0.

---

## The measured answer to "is the churn acceptable?"

No. It is not 3–4 stage changes; it is **ten renders / nine spoken announcements**, up
from four, and the sequence **runs backwards**. Recorded from the real DOM in Chromium
with the route and `LanguageModel` stubbed (`MutationObserver` on
`[data-testid="concierge-status"]`), and reproduced independently under vitest/jsdom:

| # | Announced | Source | Honest? |
|---|---|---|---|
| 1 | Looking for the right pages… | server phase 1 `routing` | yes |
| 2 | Reading what the site knows… | server phase 1 `retrieving` | yes |
| 3 | Writing an answer… | server phase 1 `generating` (concierge.ts:222) | **no** — the server stops at the seam (`:233`) and never writes |
| 4 | Writing an answer on your device… | `ON_DEVICE_STAGE` | yes |
| 5 | Checking every sentence against its source… | `setStage(STAGE_LABEL.verifying)` (:216) | **no when the device failed** — fires on the `null` draft too |
| 6 | Looking for the right pages… | server phase 2 `routing` | **rewind to step 1** |
| 7 | Reading what the site knows… | server phase 2 `retrieving` | rewind |
| 8 | Writing an answer… | server phase 2 `generating` (:222) | **no** — the draft already exists; only verification remains |
| 9 | Checking every sentence against its source… | server phase 2 `verifying` (:295) | yes |
| 10 | (cleared) | `finally` | not spoken (`aria-relevant` default excludes removals) |

Four of the nine are misleading, and steps 6–7 tell a blind guest the concierge gave up
and started over. The server-only baseline is a clean, monotonic 4.

Compounding it: **three `aria-live="polite"` regions are active at once** during a turn —
the layout's `.sr-only` announcer, the panel's `role="log"` conversation
(`aria-relevant="additions text"`), and the stage `<p>`. Polite regions queue rather than
interrupt, so the answer itself is announced **last**, behind all nine stage messages.

`ON_DEVICE_STAGE` also disappears entirely when device generation resolves inside one
macrotask — React 19 batches it with the `verifying` set on the next line. Real models are
slow enough that it renders in practice; a fast one silently skips it.

## Blockers (must fix)

- **[live region] Nine announcements per question, non-monotonic.** → In the on-device
  path, filter `status` events: ignore phase 1's `generating` and phase 2's
  `routing`/`retrieving`/`generating`, leaving routing → retrieving → on-device →
  verifying (4, monotonic, honest).
- **[content/honesty] "Checking every sentence against its source…" is announced when the
  device produced nothing.** The failure and success paths are byte-identical to a screen
  reader. → Guard it: `if (draft) setStage(STAGE_LABEL.verifying!)`.
- **[content/honesty] "Writing an answer…" is announced twice for an answer the server
  never writes** (phase 1) and again after it is already written (phase 2). → Falls out of
  the filter above; do not narrate a step that is not happening.
- **[usability/latency] A slow-but-`available` device silently adds up to 20 s before the
  server is even asked, with no cancel.** `readyOnDevice()` gates on `available`, which
  means *downloaded*, not *fast* — the mid-range Android with Gemini Nano resident is
  exactly the device that hits the ceiling. Worst case is RT1 + 20 s + RT2-with-full-server-
  generation versus one round trip before. The panel offers no Stop and no "this is taking
  longer than usual". → Cut `ON_DEVICE_TIMEOUT_MS` to ~5 s, or race the server request in
  parallel and take whichever lands first; either way add a Stop button that aborts the turn.

## Should fix

- `.cq__button:disabled` (concierge.css:37) is dead — the button is never `disabled`, only
  `aria-disabled` (a deliberate, well-reasoned tab-order choice). Measured `opacity: 1`
  while it announces as unavailable. → Add `.cq__button[aria-disabled="true"]` to that rule.
- Submitting while busy is silently swallowed (`if (asked.length < 2 || busy) return`). A
  guest who presses Enter again gets no response of any kind. → Announce or ignore
  visibly; do not fail silent.
- Three concurrent progress strings stack inside ~120 px at 390 px: "Working on it…" (in
  the log), the stage line, and "Asking…" on the button. → Drop the pending-bubble string
  while a stage is showing.
- The conversation log's `aria-relevant="additions text"` re-announces the answer as each
  sentence is appended. → Consider announcing the completed answer once.

## Consider

- `PRODUCT.md` §Surfaces lists this page as `/ask`; the implemented route is `/ask-us` and
  `/ask` returns 404. → Redirect, or correct PRODUCT.md.
- The on-device path spends **two rate-limiter tokens and two retrievals** per question,
  halving the effective budget (20/min → 10/min) for precisely the guests the feature
  exists to serve.
- Focus stays on the send button after an answer; a follow-up needs Shift+Tab.

## What is working (keep)

- **The architecture.** Generation is the only pipeline step that needs a model, so moving
  just that step to the device — and believing nothing it returns, re-retrieving and
  verifying the draft against fresh sources — is a genuinely original idea, cleanly cut at
  the right seam and covered by integration tests.
- `readyOnDevice()`'s `available`-only gate with a fire-and-forget background download is
  the right call, and it is tested.
- `streamTurn` is a clean extraction; both halves of the exchange are one code path.
- Token discipline is perfect: no raw hex, no `font-family` literal in the component or its
  CSS; computed families are the theme's (Josefin Sans), none banned.
- 17 px computed on body, input, hint, button and stage line. Send button 284×44.
- Visible `<label>` correctly associated (`for` = `useId`), no placeholder-only labels.
- No motion in the panel at all (0 `animation`/`transition`/`@keyframes`), so nothing to
  audit; `prefers-reduced-motion` is handled globally at base.css:145.
- Copy is in voice and honest — "It cannot book, submit, or change anything" is exemplary.

## Evidence

- Screenshots (390/768/1440, panel closed and open; plus 390 mid-turn and answered):
  `.impeccable/review/2026-09-07-*.png`
- `npx impeccable detect --json src/components/concierge/` → `[]`, exit 0
- `npm run design:lint` → 0 errors, 0 warnings, 1 info
- axe-core (wcag2a/2aa/21a/21aa/22aa), 390 px, panel open **and** with a live conversation
  → **0 violations** both times
- Raw-value grep over `concierge/*.{tsx,ts,css}` → no hex, no `font-family`
- Stage sequence recorded twice: real Chromium (`MutationObserver`) and vitest/jsdom
- Motion pass skipped per the skill: the target has no motion
- `npm run test:a11y` not run — the repo's Playwright revision (1234) does not match the
  installed browser (1194) and `playwright install` was out of scope; axe was driven
  directly against the same binary instead, in states the suite does not reach

## Next command

`/impeccable polish src/components/concierge/ConciergePanel.tsx --focus live-region`
