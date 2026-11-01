# Social sign-in (Google & Facebook)

Fallback guest sign-in when email codes are awkward. **Primary sign-in remains email OTP**; social buttons appear under **Other ways to sign in** only when credentials are configured.

## Tooling

This feature was implemented with **Cursor Cloud Agent** (Grok Build CLI / Kimi were not used in this environment).

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google button | OAuth 2.0 client (Web application) |
| `GOOGLE_CLIENT_SECRET` | Google button | Stored server-side only |
| `FACEBOOK_CLIENT_ID` | Facebook button | Facebook Login app ID |
| `FACEBOOK_CLIENT_SECRET` | Facebook button | App secret |
| `GUEST_PHONE_SIGN_IN` | Phone UI placeholder | `on` shows copy only until Twilio is wired |

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
5. OAuth consent screen: External, publish when ready; scopes used: `openid`, `profile` (no email scope — matching is **name-only**).

## Facebook Login setup

1. [developers.facebook.com](https://developers.facebook.com/) → My Apps → Create app → **Consumer** / Login use case.
2. Facebook Login → Settings → Valid OAuth Redirect URIs: Facebook redirect URI from the table.
3. App ID → `FACEBOOK_CLIENT_ID`, App Secret → `FACEBOOK_CLIENT_SECRET`.
4. Permissions: `public_profile` only (name fields; no email).

## Matching rules (product)

- Match guests **by name only** (given, family, full name from the provider). Email and phone from the provider are ignored.
- Normalization covers case, diacritics, punctuation, whitespace, common nicknames, maiden/hyphenated surnames, and `guests.alternate_names` (editable in admin guest ops).
- **Exactly one** confident name match **and** a usable invitation with `sent_at` set → bind provider account + guest session.
- **Linked provider account** (prior successful bind) → sign in by subject id without re-matching names.
- Any other outcome → **`/sign-in/pending`** (“Come back when your invitation has been sent!”) with the same page for zero match, ambiguous match, invitation not sent, or already claimed by another identity. Attempts are logged in `social_auth_reviews` for admin linking (`admin_link_social_auth`).

Mark an invitation as sent from the admin console (`admin_mark_invitation_sent`) once the paper or email invitation goes out.

## Security

- OAuth **state** + **PKCE** (S256); state stored in HttpOnly cookie `wedding.social_oauth`.
- Rate limits on start and callback per client IP (via the `rate-limit` provider).
- Minimum response timing on callback to reduce timing oracle between outcomes.

## After sign-in

Redirect to `next` when it passes `isSafeReturnPath`; otherwise **`/guests`**.
