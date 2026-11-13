# Rubric: multi-contact guests + auth edge cases

## How the council scores

1. **Matrix completeness:** Every row below must exist with accurate expected behavior, guest copy, and a **real test** (`tests/...` or `matrix row ID` in the test name). A reviewer who finds a missing scenario adds a row; until the row is filled and tested, that criterion scores **0** for all harnesses.
2. **Per-row score:** **1** = behavior matches + test passes in CI; **0** = mismatch, missing test, or flaky.
3. **Perfect approval:** **1 on every row** + summary gates **G1–G5** (below).

Harnesses without CLI quota on this VM use **Cursor Task** reviewers on distinct model families (documented in `multi-contact-guests-reviews.md`).

### Summary gates

| Gate | Requirement |
|------|-------------|
| G1 | All matrix rows scored 1 |
| G2 | `docs/social-auth.md` matches matrix |
| G3 | No real PII in tests/migrations |
| G4 | Design doc decisions match implementation |
| G5 | `multi-contact-guests-reviews.md` records every council round |

---

## Edge-case matrix

**Guest copy** uses stable codes from `ERROR_COPY` or capability strings unless noted. **Timing:** OTP and social callback paths use intentional floors (`holdToFloor`, `hold`) so unknown vs known is not distinguishable by latency alone where documented.

### Contacts & storage (C)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| C-01 | Secondary email on `guest_contacts` | `findGuestsByEmail` resolves guest; OTP sent to typed address | Same success path as primary; mask shows typed local | `tests/integration/guest-contacts.test.ts` secondary email sign-in |
| C-02 | Secondary phone on `guest_contacts` | `findGuestsByPhone` resolves; SMS to typed E.164 | Masked phone in confirmation | `guest-contacts.test.ts` secondary phone |
| C-03 | Primary mirrors contact | After admin edit, `guests.email`/`phone` = primary row | N/A (admin) | `tests/unit/guests/contacts.test.ts` replace primary |
| C-04 | Backfill migration | Existing rows → contact with `is_primary` | N/A | `tests/integration/guest-contacts.test.ts` backfill |
| C-05 | Delete guest | FK cascade removes contacts | N/A | unit contacts + schema |
| C-06 | Merge guests | Contacts move to kept guest; merged inert | N/A | integration guest merge |
| C-07 | Admin adds contact owned by other guest | Write rejected; no steal | Admin: “Belongs to another guest.” | `guest-contacts.test.ts` cross-guest conflict |
| C-08 | Duplicate contact same guest | Validation error | Admin: duplicate on this guest | unit `replaceGuestContacts` |
| C-09 | Move contact A→B | Old guest loses value; existing sessions unchanged until re-auth; binding stays on identity not contact string | N/A | `guest-contacts.test.ts` move contact |
| C-10 | Remove primary while session active | Session remains until expiry; next sign-in needs remaining contact | N/A | documented + integration smoke |
| C-11 | **Shared email/phone across two guest rows** | **Disallowed** on `guest_contacts`; one row per value; shared inbox via bindings + picker (`shared-inbox.test.ts`) | Sign-in offers candidates when multiple bindings share identity | `tests/integration/identity/shared-inbox.test.ts` |

### Email normalization (E)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| E-01 | Case / whitespace | `trim` + lowercase for lookup | N/A | `tests/unit/guests/contacts.test.ts` normalize email |
| E-02 | Plus-addressing (`user+tag@domain`) | **Preserved** in normalized value (no strip) | Must match exact stored contact | `guest-contacts.test.ts` plus tag |
| E-03 | Gmail dots | **Not** merged; `a.b@gmail` ≠ `ab@gmail` | Use address on invitation | `guest-contacts.test.ts` gmail dots distinct |
| E-04 | Unicode / IDN local part | Stored normalized lowercase; match exact normalized form | Validation if invalid shape | `contacts.test.ts` unicode local |
| E-05 | Punycode domain | Accepted if `isEmailShape` | Standard validation | unit email shape |

### Phone normalization (P)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| P-01 | `(419) 344-3675` | → `+14193443675` | Sent to normalized | `tests/unit/identity/phone.test.ts` formats |
| P-02 | `419.344.3675` | Same E.164 | Same | phone.test.ts |
| P-03 | `+1 419 344 3675` | Same E.164 | Same | phone.test.ts |
| P-04 | `1-419-344-3675` | Same E.164 | Same | phone.test.ts |
| P-05 | International E.164 `+44…` | Accepted if 7–15 digits after + | SMS only if Twilio accepts | phone.test.ts international |
| P-06 | Extension `x123` / `ext 5` | **Not** supported; likely validation fail | `Enter a valid US mobile number.` | phone.test.ts extension invalid |
| P-07 | Landline / non-SMS | Lookup may succeed; if Verify fails, challenge with `smsSent:false`; verify same as wrong code | Suggest try **email** on sign-in page (copy on form) | integration phone send fail |
| P-08 | Unknown phone | Enumeration-resistant: challenge returned, no SMS | Same verify failure as wrong code | existing phone OTP tests |

### Email OTP (O)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| O-01 | Known email send | Email dispatched; challenge issued | Masked `deliveredTo` | integration identity otp |
| O-02 | Unknown email send | No mail; challenge still issued | Same shape; verify fails | integration otp enumeration |
| O-03 | Wrong code | Failed attempt logged | `ERROR_COPY.code` | unit/ integration verify |
| O-04 | Expired code | Reject | `ERROR_COPY.expired` | verify tests |
| O-05 | Lockout 15m | After 5 fails | `ERROR_COPY.locked` | otp lockout test |
| O-06 | Rate limit send | Per email+IP / email / IP | `ERROR_COPY.rate_limited` | policy tests |
| O-07 | Code on contact A, type contact B | Different challenges; code A invalid on B | `INVALID_CODE_MESSAGE` | `guest-contacts.test.ts` cross-contact |
| O-08 | Two codes in flight | Each challenge independent; only matching challenge verifies | Expired if consumed | challenge store tests |
| O-09 | Close tab, return | New request issues new challenge | Standard copy | documented; challenge expiry |
| O-10 | Resend cooldown | Rate limits apply | rate_limited | OTP_LIMITS |
| O-11 | Minor / child email on file | Excluded from sign-in list | Unknown path (no reveal) | request_otp filter child |
| O-12 | Invitation not sent | Claim path uses RECOVERY; sign-in needs binding + guest | claim vs sign_in copy | integration claim |
| O-13 | Merged guest email | `notMerged` excludes | Unknown path | repo findGuests |
| O-14 | Unknown address helpful next step | Same response shape; sign-in page static help mentions invitation / contact couple | Page lede + `guest_not_found` where applicable | sign-in page + O-02 |

### Phone OTP (T)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| T-01 | Known mobile send | Twilio Verify started | Masked phone | phone-sign-in integration |
| T-02 | Unknown number | No SMS; challenge issued | verify: wrong code | phone-sign-in |
| T-03 | SMS provider down | `smsSent:false` | Same as wrong code; UI suggests email | request_phone_otp + verify |
| T-04 | Lockout / rate limit | Same buckets as email (phone hash) | locked / rate_limited | phone buckets |

### Social — name (S)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| S-01 | Middle name variants (Michelle / Elaine / E.) | Match guest Michelle Sunder | `guest_not_found` only on fail | `name-match.test.ts` middle table |
| S-02 | Initial middle dropped | Match | N/A | name-match |
| S-03 | Nickname Mike → Michael | Match | N/A | name-match |
| S-04 | Diacritics José / Jose | Match | N/A | name-match |
| S-05 | Hyphen / maiden | Match | N/A | name-match |
| S-06 | `alternate_names` | Match | N/A | name-match |
| S-07 | Single-word provider name | No false match unless unique fuzzy | guest_not_found | name-match edge |
| S-08 | Title Dr. / Jr. / III | Stripped in normalization | guest_not_found if no match | name-match titles |
| S-09 | Emoji in name | Stripped or no match | guest_not_found | name-match emoji |
| S-10 | Non-Latin script | Normalized match only if guest record aligns | guest_not_found | name-match optional |
| S-11 | Reversed first/last in `name` field | Parsed via full `name` | match or fail | parseProviderProfile |
| S-12 | Provider name only email/handle | No guest match unless email path | guest_not_found | social no match |
| S-13 | Two guests same name | `ambiguous`; no session; review queued | `guest_not_found` + sign-in suggests email/phone | social-sign-in ambiguous |
| S-14 | Fuzzy typo one guest only | One match ≤1 edit on core given+family | success if invite sent | name-match fuzzy |
| S-15 | Fuzzy typo two guests | ambiguous | guest_not_found | name-match fuzzy |

### Social — email & account (A)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| A-01 | Verified email matches guest contact | Sign-in if invite sent + unbound | redirect guests | social email match |
| A-02 | Unverified Google email | Ignored for guest match | guest_not_found | social admin-unverified |
| A-03 | Facebook no email | Name path only | guest_not_found | social-sign-in |
| A-04 | Facebook email present | Treated verified (documented) | N/A | social-sign-in fb admin |
| A-05 | Email guest A, name guest B | `email_name_conflict`; no session | guest_not_found | social conflict test |
| A-06 | Email match, name mismatch | **Allow** email path | success | social email only |
| A-07 | Invitation not sent | fail; review `not_sent` | guest_not_found | social not sent |
| A-08 | Guest already bound other identity | `blocked`; no session | guest_not_found | social blocked |
| A-09 | Provider already linked | Sign-in without re-match | success | social linked account |
| A-10 | Admin email + on guest list | **Admin first** → `/admin` | admin session | social admin google |
| A-11 | Admin also guest | Admin path wins; browse-as for guest view | docs | social-auth.md |
| A-12 | Second provider same guest | link account | success | integration link providers |

### Social — OAuth transport (X)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| X-01 | User denies OAuth | Redirect sign-in fail | guest_not_found / generic | callback route |
| X-02 | State mismatch / missing | No session | guest_not_found | callback |
| X-03 | Replayed callback | State consumed | guest_not_found | callback |
| X-04 | Provider name change later | Linked account still works | success | linked path |
| X-05 | Multi-device sign-in | New session each time | success | session tests |
| X-06 | Failure leaves no cookie | `ok:false` → no `establishGuestSession` | guest_not_found | social no match cookies |
| X-07 | Ambiguous → admin review | `social_auth_reviews` open | guest_not_found | social reviews |
| X-08 | Timing floor | callback ≥150ms | N/A | hold tests |

### Session & UX (U)

| ID | Scenario | Expected behavior | Guest-facing message | Test |
|----|----------|---------------------|----------------------|------|
| U-01 | Social fail not half signed-in | No session cookie | `ERROR_COPY.guest_not_found` | social-sign-in |
| U-02 | Safe `next` preserved on success | redirect | N/A | social sign-in next |
| U-03 | Accessible notices | `Notice` component on errors | a11y smoke | sign-in page |
| U-04 | Mobile layout | sign-in usable 390px | e2e optional | e2e sign-in |
| U-05 | Audit / logs | No emails in info logs for unknown OTP | server log hash only | request_otp code |
| U-06 | Minor social attempt | Excluded from candidates | guest_not_found | complete filter |
| U-07 | Plus-one unnamed | Social still adult filter | per kind | integration |

---

## Social name variant reference (S-01)

Guest record: **Michelle** / **Sunder**. All provider profiles below must match:

- Michelle Sunder
- Michelle Elaine Sunder  
- Michelle E. Sunder  
- Guest first **Michelle Elaine**, last **Sunder** ↔ provider **Michelle Sunder**

---

## Council worksheet (per harness, per round)

```
Harness: <name>  Model: <slug>  Round: <n>  Artifact: design|implementation
For each row ID: score 0|1  notes
Rows added by reviewer: <IDs>
Total: <earned>/<count>  Gates G1-G5: pass/fail
```

Perfect = all rows 1, all gates pass.
