# Multi-contact guests and social sign-in (design)

## Problem

Guests need more than one email or phone for sign-in (for example work and personal numbers). Social sign-in must match by verified provider email **or** fuzzy name, without account takeover, ambiguous binds, or user enumeration.

## Schema

### `guest_contacts`

| Column | Type | Notes |
|--------|------|--------|
| `id` | text PK | |
| `guest_id` | text FK → `guests.id` ON DELETE CASCADE | Orphan contacts removed with guest |
| `kind` | `email` \| `phone` | |
| `value` | text | Normalized: lowercased email or E.164 phone |
| `label` | text nullable | Admin label (`cell`, `work`, …) |
| `is_primary` | boolean | At most one primary per kind per guest |
| `created_at`, `updated_at` | timestamptz | |

**Indexes**

- Unique `(kind, value)` — one address or number maps to at most one guest globally.
- Index on `guest_id`, index on `value` for lookup.

### Legacy columns

`guests.email` and `guests.phone` remain the **primary** contact for each kind (exports, RSVP default recipient, admin list). They mirror the primary row in `guest_contacts` after every write.

## Migration and backfill

Migration `0025_guest_contacts.sql`:

1. Create `guest_contacts`.
2. Backfill (idempotent):

   ```sql
   INSERT INTO guest_contacts (id, guest_id, kind, value, label, is_primary, created_at, updated_at)
   SELECT … FROM guests WHERE email IS NOT NULL
   ON CONFLICT DO NOTHING;  -- via unique (kind, value)
   ```

   Same for `phone`. Uses generated text ids (no real PII in migration SQL).

3. RLS: table enabled; no policies (same as `0014` pattern for new public tables).

**Production:** `db:migrate` runs on deploy (`scripts/deploy/migrate-on-deploy.mjs`) when `DATABASE_URL` is set. Supabase workflow in `.github/workflows/deploy-supabase.yml` is only needed if ops run migrations outside Vercel.

## Lookups (all login paths)

| Path | Resolution |
|------|------------|
| Email OTP | `findGuestsByEmail` → any `guest_contacts` row with `kind = email` **or** legacy `guests.email` (live, not merged) |
| Phone OTP | `findGuestsByPhone` → contacts or legacy `guests.phone` |
| OTP send | Code sent **only** to the typed address or number (unchanged) |
| Social (guest) | Verified provider email → guest via contacts **or** fuzzy name → exactly one eligible adult guest |
| Social (admin) | Verified email → `admin_roles` / `ADMIN_EMAILS` **before** guest logic (unchanged) |
| Linked provider account | By subject id, no re-match (unchanged) |
| Admin phone seed | `ensureAdminPhones` updates primary phone + contact row |
| Identity rebind | Updates primary email column + contact sync |
| Guest search / admin list | Search includes `guest_contacts.value` |
| RSVP email | Still uses primary `guests.email` on the recipient row |
| Preview viewer name | `findGuestsByEmail` on admin account email |

## Uniqueness and conflicts

- **Cross-guest:** DB unique on `(kind, value)`; domain checks before insert with a clear admin error.
- **Same guest:** Duplicate values on one guest rejected in `replaceGuestContacts`.
- **Admin add:** Cannot attach a contact already owned by another guest (prevents takeover).
- **Social:** If verified email matches guest A and name matches guest B → **no session**; review row `email_name_conflict`.

## Social sign-in (name + email)

### Verified email

- **Google:** `email_verified === true`.
- **Facebook:** Email returned only when confirmed on the account; we treat **presence of email** as verified (documented in `docs/social-auth.md` — Graph API does not expose a separate flag).

Used for:

1. Admin path (first).
2. Guest path: match against `guest_contacts` + legacy column via `findGuestsByEmail`.

Unverified provider email is **never** used for guest matching.

### Fuzzy name matching (`name-match.ts`)

Keeps existing: nicknames, diacritics, punctuation, hyphens, `alternate_names`.

**Middle names:** Compare **core given** (first significant given token) and **core family** (last token). Extra middle tokens on either side are ignored for match/no-match (Michelle / Michelle Elaine / Michelle E. Sunder ↔ Michelle Sunder).

**Typos (safe):** If no exact/nickname match, allow Levenshtein distance ≤ **1** on core given **and** ≤ **1** on core family, only when the candidate pool yields **exactly one** adult guest. Ambiguity → reject.

**Confidence:** Still `none` | `one` | `ambiguous`; social requires `one` after combining with email.

### Invitation sent

**Email and name matches both require** a usable invitation with `sent_at` set (unchanged product rule). Verified email does **not** bypass “invitation sent.”

### Existing binding

If the matched guest already has an active binding for another identity → `blocked`, no session, generic error, review queued.

### Failure response

No OAuth session cookie on failure. Redirect to `/sign-in?error=guest_not_found` with fixed copy in `ERROR_COPY` (no guest list leakage). Callback OAuth/state errors use the same guest-facing path where appropriate.

**Reviews:** Failed attempts still insert `social_auth_reviews` (reasons include `no_match`, `ambiguous`, `not_sent`, `blocked`, `email_name_conflict`) for `admin_link_social_auth`.

### Order of operations

1. Linked account → session.
2. Verified email + admin roles → admin session.
3. Eligible adults → email match + name match → resolve single guest → invitation sent → no conflicting binding → bind + session.
4. Else → review + redirect sign-in error.

## Admin API / UI

`admin_upsert_guest` accepts:

- Legacy `email` / `phone` (sync primary contact when `contacts` omitted).
- `contacts[]`: `{ kind, value, label?, isPrimary? }` — full replace when provided.
- `alternateNames[]` (optional).

List/detail responses include `contacts` and `alternateNames`.

**UI:** Guest flow step “How to reach them” supports multiple labeled emails and phones; primary drives legacy columns.

## CSV

- Columns: `email`, `phone` (semicolon-separated for multiples).
- Import builds `guest_contacts` after upsert.

## Email normalization policy

- **Case / whitespace:** `trim` + ASCII lowercase local and domain (`normalizeEmail`).
- **Plus-tags:** Preserved (no stripping). `user+invite@example.com` is distinct from `user@example.com`.
- **Gmail dots:** Not aliased; each variant is a separate contact if admins list them.
- **IDN / Unicode:** Valid if `isEmailShape`; stored lowercased; punycode domains accepted as typed after normalization.

## Phone normalization policy

- US numbers → E.164 `+1XXXXXXXXXX`; common punctuation stripped.
- Other countries accepted when already valid E.164 (7–15 digits).
- **Extensions:** Not supported (digits may fail validation).
- **Landlines:** May match a stored number; if SMS cannot be delivered, verify behaves like an invalid code and the sign-in UI directs guests to **email sign-in**.

## Shared contacts (households, couples, parents)

**Decision: disallowed across guests.** Unique `(kind, value)` on `guest_contacts` means one email or phone attaches to **at most one guest row**. Product guidance:

- Shared family inbox → assign to **one** adult guest row (often household manager); others sign in via `claim_identity` / binding picker, not duplicate contact rows.
- Parents / plus-ones with one phone → add the number to the adult who signs in, or give each person a secondary email.
- OTP with multiple bindings on one **identity** (historical) still shows the self-picker (`candidates`) — separate from cross-guest duplicate contacts.

## Privacy

No real guest emails or phones in migrations, seeds, fixtures, or tests (`example.com`, `+1555…`).

## Tests

- Unit: contacts uniqueness, backfill logic, name variant table, fuzzy single-candidate, social conflict resolution.
- Integration: secondary email/phone OTP, social email match, social name+email conflict, failure redirect without session.

## Council and implementation

Design and implementation are scored against `multi-contact-guests-rubric.md`. Rounds are logged in `multi-contact-guests-reviews.md`.

Harness note: Grok Build CLI and Kimi Code CLI are not installed in the Cloud Agent image; independent reviewers use **Cursor Task subagents** on distinct model families (Composer, Claude Sonnet, GPT) as the available harnesses with quota.
