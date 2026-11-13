# Council review log

## Auth install (2026-11-13, Round 4b)

**Source:** Tyler bot store `uploads/` → installed and **removed from uploads** (directory empty). **Never committed or printed.**

| Harness | Install | Verify |
|---------|---------|--------|
| **Grok Build** | `~/.grok/auth.json` mode 600 | `grok -p 'Reply with exactly: ok' -m grok-4.7` → **pass** (`grok models` lists default **grok-4.7**; `grok whoami` non-fatal error on this VM) |
| **Kimi Code** | `~/.kimi-code/config.toml` + credentials JSON; mirrored under `~/.kimi/` | `kimi -p 'Reply with exactly: ok' -m kimi-code/k3.1-pro` → **pass** |

Stale **grok-device-login** tmux sessions killed after file auth succeeded.

---

## Multi-harness consensus

Round **4b** uses **three independent harnesses** on the identical **96-row** rubric + gates **G1–G6**: **Grok Build** (grok-4.7), **Kimi Code** (k3.1-pro), **Cursor** (Sonnet reviewer + required vitest commands).

---

## Round 1–3

See prior sections in git history. Round 3: three Cursor model reviewers **96/96** (labeled gap-fill, not CLI).

---

## Round 4 — auth blocked (superseded)

Auth files absent on first attempt; device code **G6KV-SPEN** issued then superseded by Tyler upload sync.

---

## Round 4b — multi-harness (2026-11-13)

**Fixes before scoring:** `social-auth.md` A-11 browse-as; `A-12` admin link test + rubric row; `A-15` unit; `X-01` OAuth callback route; `S-13` ambiguous social; `T-04` phone validation + send rate limit; `U-04` 390px auth-shell contract; `no-guest-list-enumeration` unchanged.

**Required automated suites (all pass locally/CI):** `matrix-row-coverage`, `no-guest-list-enumeration-copy`, rubric integration specs, `guest-contacts`, `social-sign-in`, `social-oauth-callback`, phone sign-in.

| Harness | Model | Matrix | G1 | G2 | G3 | G4 | G5 | G6 |
|---------|-------|--------|----|----|----|----|----|-----|
| **Grok Build** | grok-4.7 | **96/96** | pass | pass | pass | pass | pass | pass |
| **Kimi Code** | kimi-code/k3.1-pro | **96/96** | pass | pass | pass | pass | pass | pass |
| **Cursor** | claude-sonnet-5-5-high | **96/96** | pass | pass | pass | pass | pass | pass |

**Round 4b verdict:** **Perfect** — all three harnesses **96/96**, all gates pass. **Do not merge** without Tyler approval.

---

## CI

PR **#129**, branch `cursor/guest-multi-contacts-b3d2`, head **`27988c26`**: design-quality + stages **green** after Round 4b push (2026-11-13).
