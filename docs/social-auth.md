# Social sign-in (Google & Facebook)

Fallback guest sign-in when email codes are awkward. **Primary sign-in remains email OTP**; social buttons appear under **Other ways to sign in** only when credentials are configured.

## Tooling

This feature was implemented with **Cursor Cloud Agent** (Grok Build CLI was unavailable in this environment; Kimi was not used).

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google button | OAuth 2.0 client (Web application) |
| `GOOGLE_CLIENT_SECRET` | Google button | Stored server-side only |
| `FACEBOOK_CLIENT_ID` | Facebook button | Facebook Login app ID |
| `FACEBOOK_CLIENT_SECRET` | Facebook button | App secret |
| Vercel connector `twilio/wedding`, or `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_VERIFY_SERVICE_SID` | "Sign in with your phone instead" | Either one: the option shows within a minute. There is no flag |

`BETTER_AUTH_URL` / production canonical origin must match the host you register with each provider.

## Redirect URIs (exact)

Register these **authorized redirect URIs** in each provider console:

| Provider | Redirect URI |
|---|---|
| Google | `https://kendrick.wedding/api/auth/social/google/callback` |
| Facebook | `https://kendrick.wedding/api/auth/social/facebook/callback` |

Preview / local (add alongside production as needed):

| Environment | Google | Facebook |
|---|---|---|
| Local | `http://localhost:3000/api/auth/social/google/callback` | `http://localhost:3000/api/auth/social/facebook/callback` |
| Vercel preview | `https://<preview-host>/api/auth/social/google/callback` | `https://<preview-host>/api/auth/social/facebook/callback` |

Start URLs (linked from the sign-in page):

- `GET /api/auth/social/google/start?next=/guests`
- `GET /api/auth/social/facebook/start?next=/guests`

## Google Cloud setup

1. APIs & Services → Credentials → Create **OAuth client ID** → Web application.
2. Authorized JavaScript origins: `https://kendrick.wedding` (and local/preview origins you use).
3. Authorized redirect URIs: table above.
4. Copy Client ID and Client secret into Vercel env as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. OAuth consent screen: External, publish when ready; scopes used: `openid`, `email`, `profile`.

## Facebook Login setup

1. [developers.facebook.com](https://developers.facebook.com/) → My Apps → Create app → **Consumer** / Login use case.
2. Facebook Login → Settings → Valid OAuth Redirect URIs: Facebook redirect URI from the table.
3. App ID → `FACEBOOK_CLIENT_ID`, App Secret → `FACEBOOK_CLIENT_SECRET`.
4. Permissions: `email`, `public_profile` (name fields plus confirmed email for administrators).

## Matching rules (product)

### Administrators (owners, planners, moderators)

- After a **linked provider account** (prior successful bind with a real inbox), sign in by subject id and land in the console.
- Otherwise, before any guest name matching, match **verified provider email** to `admin_roles` or `ADMIN_EMAILS`:
  - Google: `email_verified` must be true.
  - Facebook: email is returned only when confirmed on the account — absence means unverified.
  - Case-insensitive exact match on the normalized address → admin session, redirect to `/admin` (or a safe `next`).
- On first verified admin match, link the provider subject to that auth user for later sign-ins.
- Console administrators must have a valid email on their `admin_roles` row (enforced in the schema and admin UI).

### Guests

Guest matching uses **verified provider email OR fuzzy name** (see `docs/design/multi-contact-guests.md`).

- **Linked provider account** → sign in by subject id without re-matching.
- **Verified email** → match any row on `guest_contacts` or `guests.email` (same normalization as OTP). Google requires `email_verified`. Facebook: treat a returned email as verified (documented in design).
- **Fuzzy name** → middle initials ignored; nicknames, diacritics, hyphens, `alternate_names`; typo tolerance only when **exactly one** adult matches.
- Email match wins when name differs; **email + name → different guests** → no session (`email_name_conflict`).
- **Invitation sent** required for both paths.
- **Failure** → no session; `/sign-in/save-the-date` (warm save-the-date copy — never implies list membership). Attempts stay in `social_auth_reviews` for `admin_link_social_auth`.

Mark an invitation as sent from the admin console (`admin_mark_invitation_sent`) once the paper or email invitation goes out.

## Security

- OAuth **state** + **PKCE** (S256); state stored in HttpOnly cookie `wedding.social_oauth`.
- Rate limits on start and callback per client IP (via the `rate-limit` provider).
- Minimum response timing on callback to reduce timing oracle between outcomes.

## Multi-contact emails

Social guest email matching uses `findGuestsByEmail` (contacts + legacy column). Secondary addresses work when the provider returns that exact verified email.

## After sign-in

Redirect to `next` when it passes `isSafeReturnPath`; otherwise **`/guests`**.
