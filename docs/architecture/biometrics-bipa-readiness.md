# Biometric readiness (Swarm I) — removed

> **Status: the feature this described no longer exists.** On 2026-09-18 the couple asked for
> photo-grouping-by-face to be removed from the site. It was removed rather than switched off, so
> there is nothing left for a readiness note to describe.

## What was removed

Every part of it, in one commit:

- the guest surfaces — the "look for you in them" link on `/photos` in both designs, and the
  `/media/me` page behind it;
- the thirteen capabilities (consent draft/grant/revoke, enrolment, matching, deletion request,
  and the four admin ones), their HTTP route, and the WebMCP exposure that never included them;
- the admin screen and its navigation entries;
- the provider, the domain module (gate, vault, consent, enrolment, retention jobs) and the
  `biometric` database schema, dropped by migration `0010`;
- the `BIOMETRICS_ENABLED` flag, its legal gate, the `use_face_matching` entitlement, and
  `BIOMETRIC_VAULT_KEY` / `BIOMETRIC_RETENTION_DAYS`.

Semantic photo search stays. It indexes what a picture *shows* — a place, a moment, a caption
somebody wrote — and never who is in it. That is the feature guests were actually offered on
`/photos`, and it needs no consent from anyone.

## Why the record is kept

The reasoning in [ADR-0006](../adr/0006-biometric-isolation-and-feature-gate.md) still applies to
anything that would bring face matching back: the wedding is in Illinois, BIPA regulates face
geometry and carries a private right of action, and guests include children and people who agreed
to nothing beyond attending a wedding. Collecting none of it is a stronger answer than any gate.

Reintroducing it is not a feature decision. It needs the couple, an Illinois-licensed privacy
attorney, a consent ceremony, a retention schedule, an isolated vault, and a revisit of ADR-0006 —
in that order.
