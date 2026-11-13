# Council review log

## Harness availability (this environment)

| Harness | Available | Notes |
|---------|-----------|--------|
| Grok Build CLI | No | `grok` not on PATH |
| Kimi Code CLI | No | not on PATH |
| OpenAI Codex CLI | No | not on PATH |
| **Cursor Task** (Composer 2.5) | Yes | primary implementer |
| **Cursor Task** (Claude Sonnet 5.5) | Yes | reviewer |
| **Cursor Task** (GPT 5.6) | Yes | reviewer |
| **Cursor Task** (Gemini 4 Hydrogen) | Yes | reviewer |

Implementation coding used **Cursor (Composer)** directly after CLI harnesses were unavailable (per Tyler’s fallback rule).

---

## Round 1 — design + matrix

| Harness | Model | Matrix rows passed | Gates | Notes |
|---------|-------|-------------------|-------|-------|
| Composer | composer-2.5 | author | — | 84-row matrix in `multi-contact-guests-rubric.md` |
| Sonnet reviewer | claude-sonnet-5-5-high | 21/97 | G1–G5 fail | +13 suggested rows (e.g. S-16, C-12) |
| GPT reviewer | gpt-5.6-sol-high | 34/84 | G1–G5 fail | many rows lack dedicated tests |
| Gemini reviewer | gemini-4-hydrogen-high | 36/84 | G1–G5 fail | +rows C-12–U-13 |

**Round 1 verdict:** not perfect. Missing per-row tests and partial social/name coverage remain.

---

## Copy pass (Tyler) — save-the-date, no list signal

Social/OTP failures redirect to `/sign-in/save-the-date` (not `error=guest_not_found`). Rubric **G6** + `no-guest-list-enumeration-copy.test.ts`.

## Round 2 — implementation (in progress)

| Harness | Model | Matrix rows passed | Gates | Notes |
|---------|-------|-------------------|-------|-------|
| Composer | composer-2.5 | — | — | Fixes: social-admin link test, `social-auth.md` restore, OTP O-07, contacts TS |

Scores will update after `npm run verify` is green and reviewers re-run.
