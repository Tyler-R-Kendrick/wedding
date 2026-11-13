# Council review log

## Device login (in progress)

**Grok Build** — open https://accounts.x.ai/oauth2/device?user_code=**G6KV-SPEN** and confirm code **G6KV-SPEN** (tmux `grok-device-login-4`, 2026-11-13). Use this **or** drop Tyler's shared auth files into `/cursor/stores/bot/uploads/` (see Round 4); do not share the code unless you started this login.

---

## Tyler shared auth install (Round 4)

**Procedure run (no secrets logged):** copy `grok-auth.json` → `~/.grok/auth.json` (mode 600); copy `kimi-config.toml` → `~/.kimi-code/config.toml` and credentials JSON → `~/.kimi-code/credentials/` (and mirrored under `~/.kimi/` when present); delete source copies under `uploads/` after install.

**Result (2026-11-13):** **Source files not on this VM.** Searched `/cursor/stores/bot/uploads`, `/agent/repos/wedding/uploads`, and agent store paths — expected filenames absent after 2+ minutes (background watcher still polls `bot/uploads` + wedding `uploads/`). **No auth files were committed, printed, or written into the repo.**

### Auth verification (names only)

| Harness | Probe | Result |
|---------|-------|--------|
| **Grok Build** | `grok whoami` | **fail** (not authed; device code active above) |
| **Grok Build** | `grok -p 'say ok' -m grok-4.6` | **not run** (depends on auth) |
| **Kimi Code** | `kimi -p 'say ok' -m …` | **fail** (no `~/.kimi-code/config.toml`) |

---

## CLI install results (this VM, 2026-11-13)

Env secret names probed: none of `XAI_API_KEY`, `GROK_DEPLOYMENT_KEY`, `KIMI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY` (no values logged).

| CLI | Install command | Exit | Last output lines |
|-----|-----------------|------|-------------------|
| **Grok Build** | `curl -fsSL https://distro.x.ai/grok/install.sh \| bash` | **0** | `Grok 1.0.77 installed to /home/ubuntu/.grok/bin/grok` / `Run 'grok' or 'agent' to get started!` |
| **Grok version** | `grok --version` | **0** | `grok 1.0.77 (50ca579fa996)` |
| **Kimi Code** | (preinstalled) `kimi --version` | **0** | `2.6.0` |
| **Codex** | `npm i -g @openai/codex` | **0** | `added 7 packages` → `codex-cli 0.168.0` |
| **Gemini CLI** | `npm i -g @google/gemini-cli` | **0** | `added 7 packages` → `0.68.0` |

### Auth probes (names only; no secrets)

| Harness | Command | Exit | Result |
|---------|---------|------|--------|
| Grok | `grok whoami` | 0 | `Error: No such device or address` (not authed) |
| Kimi | `kimi session list` | 0 | empty / no session |
| Codex | `codex login status` | 0 | `Not logged in` |
| Gemini | `gemini -p ok` | 0 | requires `GEMINI_API_KEY` or settings auth |

**Multi-harness consensus:** **Not met** — zero CLIs authenticated. Round 3 scoring uses **three distinct Cursor model reviewers** (labeled below); not equivalent to three CLI harnesses.

---

## Matrix coverage gate

- Rubric row IDs: **96** (84 core + council extensions + **U-08** / **G6**).
- `tests/unit/rubric/matrix-row-coverage.test.ts`: every ID appears in at least one vitest name; **0 missing**.
- Behavioral depth added this round: `guest-contacts.test.ts` **O-15/C-01**, **T-05/C-02**, **O-07**; `council-extensions.test.ts` **C-12–X-09**; `social-sign-in.test.ts` **U-06/U-07/U-08**; strengthened **E-03/C-03/S-03/S-11**.

---

## Round 1 — design + matrix

| Harness | Model | Score | Gates | Notes |
|---------|-------|-------|-------|-------|
| Composer | composer-2.5 | author | — | initial 84-row matrix |
| Sonnet (Cursor) | claude-sonnet-5-5-high | 21/97 | G1–G5 fail | suggested extension rows |
| GPT (Cursor) | gpt-5.6-sol-high | 34/84 | G1–G5 fail | shallow coverage |
| Gemini (Cursor) | gemini-4-hydrogen-high | 36/84 | G1–G5 fail | +C-12… |

**Round 1 verdict:** not perfect.

---

## Round 2 — implementation council

| Harness | Model | Score | Gates |
|---------|-------|-------|-------|
| Sonnet (Cursor) | claude-sonnet-5-5-high | 56/84 | G1,G3,G4,G5 fail; G2*, G6 pass |
| GPT (Cursor) | gpt-5.6-sol-high | 56/84 | G1–G5 fail; G6 pass |
| Gemini (Cursor) | gemini-4-hydrogen-high | 70/84 | G1,G3,G4,G5 fail; G2,G6 pass |
| Grok / Kimi / Codex | — | — | not authed |

**Round 2 verdict:** not perfect.

---

## Round 3 — post-test depth (2026-11-13)

**Local automated gates:** `npm run check` pass (typecheck, lint, unit+ui+stages); rubric matrix **96/96** ID coverage; `no-guest-list-enumeration-copy.test.ts` pass; integration specs above pass locally.

Identical rubric: `docs/design/multi-contact-guests-rubric.md` (**96 rows**, gates **G1–G6**).

| Reviewer | Kind | Matrix | G1 | G2 | G3 | G4 | G5 | G6 |
|----------|------|--------|----|----|----|----|----|-----|
| Sonnet | **Cursor model reviewer** (CLI gap-fill) | **96/96** | pass | pass | pass | pass | pass | pass |
| GPT 5.6 | **Cursor model reviewer** (CLI gap-fill) | **96/96** | pass | pass | pass | pass | pass | pass |
| Gemini Hydrogen | **Cursor model reviewer** (CLI gap-fill) | **96/96** | pass | pass | pass | pass | pass | pass |
| Grok Build | CLI (unauthed) | — | — | — | — | — | — | — |
| Kimi Code | CLI (unauthed) | — | — | — | — | — | — | — |
| Codex | CLI (unauthed) | — | — | — | — | — | — | — |
| Gemini CLI | installed, unauthed | — | — | — | — | — | — | — |

**Round 3 verdict:** **Perfect** on rubric rows and gates for all three Cursor model reviewers. **Council sign-off blocked on multi-harness rule** until Tyler completes Grok device login (and optionally Kimi/Codex/Gemini auth); re-run CLI harness scoring when available.

**Do not merge** without Tyler approval.

---

## Round 4 — multi-harness (Grok + Kimi + Cursor)

**Rubric:** identical **96 rows**, gates **G1–G6** (`multi-contact-guests-rubric.md`).

| Harness | Kind | Matrix | G1–G6 | Notes |
|---------|------|--------|-------|-------|
| **Grok Build** | CLI (`grok-4.6`) | — | — | **Auth fail** — Tyler auth files not mounted; device login pending |
| **Kimi Code** | CLI (target **K3.1** when authed) | — | — | **Auth fail** — no config/credentials installed |
| **Cursor** | Cursor harness (Sonnet reviewer, tests + spot-check) | **96/96** | all pass | `matrix-row-coverage` + rubric integration specs green locally |

**Deductions / fixes:** none required for rubric rows after Round 3; Cursor Round 4 re-run confirms **96/96**.

**Round 4 verdict:** **Incomplete multi-harness** — only **Cursor** scored. **Grok** and **Kimi** blocked until auth files appear in `bot/uploads/` or device/OAuth completes. Then re-run Round 4b with the same rubric until both CLIs report **96/96** and all gates pass.

**Do not merge** without Tyler approval.

---

## CI

PR **#129**, branch `cursor/guest-multi-contacts-b3d2`, head **`2a0aa7a7`**: all required GitHub checks **green** (2026-11-13).
