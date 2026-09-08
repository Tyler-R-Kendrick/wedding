# Professional media rights

**Not legal advice.** This is an operational checklist for one decision: whether
files delivered by the photographer and the videographer may be sent to a
third-party AI model for captioning, tagging or search. The feature is off, it
cannot be turned on by an environment variable alone, and this document is what
turning it on waits for.

## What the gate protects

`PRO_MEDIA_AI_PROCESSING` is `false` in `src/contracts/flags.ts` and is one of
the two flags in `READINESS_GATED`. Both are required:

1. `FLAG_PRO_MEDIA_AI_PROCESSING=on` in the environment, **and**
2. the readiness switch recorded on `/admin/flags` by an admin.

With either missing, media marked as professionally delivered is excluded from
every AI path — captioning, embedding, semantic search indexing — while
guest-uploaded media continues to work normally. That separation is the point:
semantic search over the guests' own photographs does not wait on a vendor's
permission, and the tests assert that it keeps working with this gate shut.

## Why it is a gate at all

A wedding photographer's contract usually assigns the couple a **licence to use
the images**, not ownership of them, and licences are commonly silent on — or
explicitly hostile to — machine learning. Sending delivered files to a model
provider is a transfer to a third party and, depending on the provider's terms,
potentially a contribution to training data. That is a decision for the person
who holds the copyright, which is the photographer, not the couple and certainly
not this repository.

The same reasoning applies to the videographer, and to any second shooter whose
files arrive through the main vendor.

## The checklist

Everything below must be true before the readiness switch is flipped. Record the
answers in `docs/content/backlog.md` against the relevant item.

- [ ] **Written confirmation from the photographer** that delivered files may be
      processed by a named third-party AI provider for captioning, tagging and
      search. Email is fine; a verbal yes is not, because the person who has to
      rely on it later may not be the person who heard it.
- [ ] **Written confirmation from the videographer**, same terms.
- [ ] **The provider is named** in the confirmation, not "an AI service". The
      current default is Anthropic (`ANTHROPIC_API_KEY`, `MEDIA_AI_PROVIDER`);
      changing the provider invalidates the permission.
- [ ] **Training is addressed explicitly.** Confirm with the provider, in their
      current terms, whether API content is used for training, and put the
      answer in front of the vendors before asking them to agree.
- [ ] **Second shooters and assistants** are covered by the main vendor's
      confirmation, or have given their own.
- [ ] **Guests in the frame.** This gate is about the vendors' rights. It is not
      consent from the people photographed, and it is **not** a route to face
      matching — that is `BIOMETRICS_ENABLED`, a separate gate with a separate
      legal basis (`docs/architecture/biometrics-bipa-readiness.md`).
- [ ] **A way back.** Deleting a derivative from this site does not delete
      anything the provider retained. Know the provider's retention policy
      before the first file is sent, not after.

## What happens if it is never turned on

Nothing breaks. Professional media is stored, served and shown exactly as it is
today; it simply carries no machine-generated captions or tags and does not
appear in semantic search results. Alt text for professionally delivered images
is then a human task, which is the honest fallback and is tracked in the content
backlog.

This is the intended steady state. The gate exists so that "we never got round
to asking the photographer" produces a site that works, rather than a site that
has already sent the files.
