# Council review log

## Harness availability (this VM, 2026-11-13)

| Harness | On PATH | Auth | Notes |
|---------|---------|------|--------|
| **Grok Build** `1.0.77` | Yes (`~/.grok/bin/grok`) | **Pending device login** | No `XAI_API_KEY` / `GROK_DEPLOYMENT_KEY` in env. Active code: **ZS4T-XJ4S** — https://accounts.x.ai/oauth2/device?user_code=ZS4T-XJ4S (tmux `grok-device-login-2`). Previous code `45HW-NNR4` / `O8IX-L93X` expired. |
| **Kimi Code** `2.6.0` | Yes (`~/.kimi-code/bin/kimi`) | **Not authed** | This build has no `kimi session login` (only `session list`). Prior device flow timed out after 900s. Re-auth needs Tyler on a build that exposes login or a Kimi API key in env (none present). |
| **OpenAI Codex** `0.168.0` | Yes (`~/.local/bin/codex`) | **Not logged in** | `npm i -g @openai/codex` to user prefix; `codex login status` → not logged in; no `OPENAI_API_KEY` in env. |
| **Claude Code / Gemini CLI** | No | — | Not installed on PATH; install scripts not run (no keys in env). |
| **Cursor Task reviewers** | Yes | N/A | Sonnet 5.5, GPT 5.6, Gemini 4 Hydrogen used for Round 2 scoring below. |

**Multi-harness consensus:** **Not met** — only Cursor-internal model reviewers scored Round 2; Grok/Kimi/Codex are installed but unauthenticated, so no distinct CLI harness scored the rubric.

Implementation coding on this branch: **Cursor Composer** (fallback per Tyler when CLIs are unauthed).

---

## Round 1 — design + matrix

| Harness | Model | Matrix rows passed | Gates | Notes |
|---------|-------|-------------------|-------|-------|
| Composer | composer-2.5 | author | — | 84-row matrix in `multi-contact-guests-rubric.md` |
| Sonnet reviewer | claude-sonnet-5-5-high | 21/97 | G1–G5 fail | +13 suggested rows (e.g. S-16, C-12) |
| GPT reviewer | gpt-5.6-sol-high | 34/84 | G1–G5 fail | many rows lack dedicated tests |
| Gemini reviewer | gemini-4-hydrogen-high | 36/84 | G1–G5 fail | +rows C-12–U-13 |

**Round 1 verdict:** not perfect.

---

## Copy pass (Tyler) — save-the-date, no list signal

Social/OTP failures redirect to `/sign-in/save-the-date`. Rubric **G6** + `no-guest-list-enumeration-copy.test.ts`.

---

## Round 2 — implementation + council (2026-11-13)

**Code deltas since Round 1 (non-exhaustive):** save-the-date paths; `guest_contacts` + migration `0025` + drizzle `0025_snapshot`; matrix ID tests; CI fixes (`ad4-step` seed, `ensureAdminPhones` await, e2e save-the-date); `listMatchableGuests` excludes unnamed plus-ones (`U-07`); `get_my_invitation` shared-household inbox parity with `claim_identity` (e2e Fitzgerald “I’m Tyler”).

| Harness | Model | Matrix rows passed | Gates | Notes |
|---------|-------|-------------------|-------|-------|
| Sonnet (Cursor) | claude-sonnet-5-5-high | **56/84** | G1 fail, G2 pass*, G3 fail, G4 fail, G5 fail, G6 pass | \*G2 partial off non-social rows |
| GPT (Cursor) | gpt-5.6-sol-high | **56/84** | G1–G5 fail, G6 pass | 28 failing row IDs listed in agent transcript |
| Gemini (Cursor) | gemini-4-hydrogen-high | **70/84** | G1,G3,G4,G5 fail; G2,G6 pass | Strict assertion review |
| Grok Build | — | — | — | Not authed — no score |
| Kimi Code | — | — | — | Not authed — no score |
| Codex | — | — | — | Not authed — no score |

**Automated gates (local):** `matrix-row-coverage.test.ts` **84/84 IDs in test names**; `no-guest-list-enumeration-copy.test.ts` pass; `npm run check` pass after Round 2 fixes.

**CI (PR #129, head `c53ee8d7` + follow-up commits):** `typecheck · lint · unit · integration · build` **pass**; Playwright smoke **failed once** on `claim.spec.ts` mobile (missing “I’m Tyler” — addressed in `get_my_invitation` shared-inbox fix, pending re-run).

**Round 2 verdict:** **Not perfect.** Council range **56–70/84**; no harness reports 84/84. Remaining work: deepen tests for shallow rows (C-01/02, O-07/08, S-11, U-03/04/06/07, X-01, etc.), G3 PII scrub (`+1419…` rubric phone examples vs `555` fixtures), G5 this log (done), optional new rows (C-12–U-08) from Round 1 suggestions.

---

## Round 3 — (not started)

Target: close gaps to **84/84** with behavioral tests, green CI including Playwright, **≥3 authenticated CLI harnesses** re-score with identical rubric, all **G1–G6** pass. Do not merge until Tyler approves.
