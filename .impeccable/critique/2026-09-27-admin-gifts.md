# Design review — /admin/gifts — 2026-09-27

## Verdict: FIX FIRST
Scores (1–10): Design 7 · Usability 6 · Creativity 8 · Content 7
(Ship threshold: all ≥ 7 and Usability ≥ 8 — see wedding-site-standards §5)

Surface: admin, root DESIGN.md "shared foundation". Reviewed empty state (no registry, no rails, 4 built-in funds) at 390/820/1280 plus all three sheets, via a NODE_ENV=test server as fixture ADMIN1.

## Blockers (must fix)
- [capture/390] Bottom sheet does not contain its own scroll, so the footer (Continue/Save) is below the fold. On the rail sheet step 1 the footer sits at y=1039–1119 in an 844px viewport; on registry step 3 it sits at y=1012. The whole dialog scrolls, the header and progress bar scroll away, and the `<dialog>` itself becomes a tab stop. Cause: `src/components/admin/flow/flow.css:117-122`, where `.flow-frame { max-height: inherit }` inherits `min(92dvh, 100%)` and the `100%` resolves against the auto-height dialog, so nothing is constrained (measured: frame 1046px, body clientHeight equal to scrollHeight). → Set `.flow-frame { max-height: 92dvh }` (100dvh at ≥48rem) and `.flow-body { min-height: 0 }`.
- [code] "Change" on a hidden registry link re-publishes it: `RegistryFlow.tsx:162` always sends `active: true`, and the success line (`:152`) says "Guests see it on the Gifts page now." → Add `active` to `RegistryLinkSummary` (`:19-27`) and send `existing?.active ?? true`.
- [detector, rendered] `text-occlusion` fires 11–12 times per viewport. Every hit is the console nav's closed "All admin screens" `<details>` (`AdminIndex`, `src/app/(admin)/admin/_components/console.tsx:335`). `checkVisibility()` is false for those nodes, and `/admin/rsvp` produces the same findings, so this is the documented closed-details false positive and was not introduced by this page. It is unwaived, though, so the gate fails. → Add a `text-occlusion` ignoreValue for `**/admin/*` in `.impeccable/config.json` with the checkVisibility reason (same form as the your-weekend waiver), or render the closed index `hidden="until-found"`.

## Should fix
- [structure] The status panel repeats the three steps almost word for word ("Not linked. Guests are told you have not chosen…" and "No registry linked. Guests read that you have not chosen…"). At 390 it fills the first viewport, and the first action ("Link your registry") starts around y≈1000. `page.tsx:87-100` vs `:113-230`. → Keep the headline, the "In guests' menu" fact (the only one not in the steps) and the next step's button in the panel; drop the three duplicate checks.
- [DESIGN.md: "button-primary … One per viewport"] In the empty state both "Link your registry" (`page.tsx:164`) and "Add a way to give" (`:193`) are filled ink pills, visible together at 1280. → Use primary only for the step where `setup.next` matches; ghost for the others.
- [DESIGN.md: "If terracotta appears more than twice in one viewport, it has stopped being an accent"] The 1280 fold has three terracotta uses: the eyebrow (`gifts.css:24`), "Open the Gifts page" (`:112`) and "Next" (`:204`). The terracotta-tinted `.gs-blocked` box (`:229-230`) is a fourth nearby. → Set "Next" and the not-live eyebrow in ink (or sage), and give `.gs-blocked` a neutral paper tone.
- [usability] Continue is disabled with no stated reason (for example registry step 2 until the box is ticked), drawn at 0.55 opacity. `AdminFlow.tsx:325` plus the `ready` gates (`RegistryFlow.tsx:66,105,138`, `RailFlow.tsx:79,107,155`, `FundFlow.tsx:40`). → Keep Continue enabled; when `!ready`, set an inline field error ("Tick this once you've opened the link").
- [a11y] Close a sheet that reopened itself (draft restore or step-up return) and focus falls to `<body>`, because nothing was focused before `showModal()` (`AdminFlow.tsx:96-98, 119-129`). → Keep a ref to the trigger button and focus it after `d.close()`.
- [a11y] Up/Down unmount the focused button: moving the 2nd fund up makes it first, so its "Up" button disappears (`page.tsx:222-223`). Success is also silent (`QuickAction.tsx:35-36`), although the header comment says the row "says what happened". → Add a `role=status` line ("Moved up.", "Hidden.") and move focus to the row's remaining move button or its title.
- [content] Three names per concept: "Registry" / "Your registry" / "wishlist"; "Ways to give" / "Ways to send a gift of money"; "Funds" / "What gifts of money go toward" (`page.tsx:88/113, 91/169, 94/196`). → Pick one label per step and use it in the status list, the step title and the sheet title.
- [code] A fund's line can't be cleared. `FundFlow.tsx:82-83` sends `undefined` for an empty description (the capability keeps the old one), but the step-2 preview shows it removed, so the preview is wrong. → Send `''` to clear it and let the capability accept that.
- [hierarchy] "What guests see" (`page.tsx:246`, `.ops-h2`) looks like a bold 17px label, smaller than the step titles and far smaller than the preview's own H1-sized title inside it. → Give it the `gs-status__title` treatment.

## Consider
- Discard (`AdminFlow.tsx:313`) throws the draft away with one tap and no undo. Add a 5-second "Undo" status or a confirm step.
- On first open the sheet and the step both animate (`flow.css:81-82` and `:228-229`). Skip the step animation when the sheet opens.
- `CheckField` (`fields.tsx:135-140`) and the radios (`:112`) never set `aria-invalid`. Mirror `TextField`.
- The status-check jump links are 18px tall (`page.tsx:344`). They pass WCAG 2.5.8 by the spacing exception, but DESIGN.md asks for 44px. Make them `inline-flex; min-height: 2.75rem`.
- `text-wrap: balance` on `.gs-status__title` (`gifts.css:31`) and `.flow-step__title` (`flow.css:245`).
- The headline "Guests have nothing to give with yet." reads awkwardly. Try "Guests can't give anything yet."
- A move is two separate saves (`page.tsx:207-210`). If the second fails, two funds share an order. A single "reorder" capability would be atomic.

## What is working (keep)
- Token discipline: drift detector 0 findings, `design:lint` 0 errors, no raw hex, only Newsreader and Libre Caslon Display render.
- axe WCAG 2.2 AA: 0 violations on the page and in each of the three sheets at 390.
- Native modal `<dialog>`: focus goes to each step's heading, Escape and the backdrop close it, and focus returns to the trigger (820/1280).
- Errors: "not a link" gives an inline "Check this: That is not a web address…", sets `aria-invalid`, focuses the field and links hint and error through `aria-describedby`. An amazon.com URL gets a plain-words allowlist refusal.
- Drafts: a reload reopens the sheet at step 2 with "Picked up where you left off." The trigger then reads "Continue: link your registry" with "Unfinished, kept on this device."
- `prefers-reduced-motion`: the sheet and step animations compute to `none`. Motion is transform and opacity only, 180–240ms, ease-out, with no bounce.
- The side sheet at 820/1280 keeps its footer in view. No horizontal overflow at any width.
- The "Try it" and "Check it is yours" steps, and the guest preview built from the real capability and components with honest "still writing this" gaps. This page's one strong idea: it shows the couple what a guest will see before anything goes live.

## Evidence
- screenshots: `.impeccable/review/gifts/` — `{390,820,1280}-page.png`, `-fold.png`, `-sheet-{registry,rail,fund}.png`; 390 also `-sheet-registry-{error,step2,step3,step3-scrolled,reload}.png`, `-sheet-rail-step2.png`, `-sheet-fund-step2.png`, `-after-close-draft.png`; raw probe `report.json`
- detector (source): 0 findings (`check-design-drift.mjs` on the gifts route dir + `components/admin/flow`)
- detector (rendered, via admin-signing proxy): text-occlusion ×11–12 per viewport, all the closed console-nav `<details>` (false positive, unwaived)
- design:lint: 0 errors, 0 warnings, 1 info
- axe: 0 serious/critical (page + 3 open sheets, 390). `npm run test:a11y` does not cover admin routes.
- Domain §8: not applicable to an admin surface. Gifts voice (PRODUCT.md) is respected in the guest preview copy.

Next command: `/impeccable polish /admin/gifts` (start with flow.css:117-122, then RegistryFlow.tsx:162).
