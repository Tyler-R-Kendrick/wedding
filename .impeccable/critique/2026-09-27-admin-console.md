# Design review: admin console (20 screens) after the flow-kit migration, 2026-09-27

## Verdict: FIX FIRST
Scores (1-10): Design 7 · Usability 7 · Creativity 7 · Content 6
(Ship threshold: all ≥ 7 and Usability ≥ 8, per wedding-site-standards §5.)

**Is the console consistent now?** Mostly. The shell is shared on all 20 screens: ConsolePage with a lede,
hairline RecordRows, the same 612px sheet, the same danger anatomy (Consequences box, confirm tick, red
button), a closed "Technical details" drawer, axe clean, and no horizontal overflow at 390px. What is still
inconsistent is **wording**: three verbs for edit, two for delete, bare vs named save and danger buttons, and
three spellings of the same RSVP state. There are also **four structural outliers** (content, lifecycle,
RSVP, the media/AI sub-nav) that do not follow the reference shape yet. The references do not fully agree
with each other either: gifts says "Change" where guests and households say "Edit".

## Blockers (must fix)
1. [detector: text-occlusion, 139 across 20 routes at 390 and 1280] Every one of them is the closed "All admin screens" `<details>`
   (src/app/(admin)/layout.tsx:54). Its `.con-index` links keep layout boxes under the page (checkVisibility() false).
   This is the same false positive as the documented /your-weekend waiver, but there is no admin waiver, so it counts.
   → Add an `ignoreValues` text-occlusion waiver for `**/admin/**` in .impeccable/config.json with that reason, or give the panel `display:none` while closed.
2. [detector: low-contrast 2.2:1] /admin/media "Approve and publish" while nothing is selected. src/components/media/admin-media.css:91-93
   `.mq-actions [aria-disabled="true"] { opacity: 0.6 }` is the exact thing media.css:125 warns against.
   → Drop the opacity. Render the disabled state as a ghost with `--color-on-surface-muted` text, or keep it enabled with a readyHint ("Select something first").
3. [detector: heading-rhythm] /admin/gifts h2 "Step 2", "Step 3": 4px above vs 16px below. The existing waiver only covers the
   guest /gifts page. gifts/_components/gifts.css:70-76 → add `.gs-step + .gs-step { padding-top: var(--spacing-lg) }` (or margin-block-start on `.gs-step__title`).
4. [kit rule, Never: "typing an id"] The content create/edit flow asks for "Slug", "Order", "Source (content_sources id)" and
   JSON arrays. These are the exact internals AdminFlow.tsx:96-99 says the kit replaced. src/domain/content/admin.ts:47 and the per-table
   `slug`/`order` fields, rendered by ContentFlows.tsx fieldStep. Empty Continue shows four bare "Required." messages
   (ContentFlows.tsx:85), where every other flow says what is missing in a sentence.
   → Derive slug from the title and order from position (Up/Down QuickActions, as funds do), choose the source from a SelectField,
   edit lists as repeatable text fields, and use a readyHint sentence per step.
5. [usability] /admin/content "Records that need attention": at 1280 the table is 1366px inside a 1188px region, so the Edit
   and Mark verified column (the only actions for 50 records) is scrolled off-screen, and each row is about 110px tall.
   content/page.tsx:62-116 → render it as the same RecordList/RecordRow that content/[table]/page.tsx:59-81 already uses. That also removes the second pattern for the same records.

## Should fix: cross-screen inconsistencies (ranked)
1. **Edit verb.** "Edit": guests, households, events (events/page.tsx:85,150), seating (:170), content. "Change": gifts (gifts/page.tsx:139,181,215),
   travel (:75,125), transport (:101), reservations (:148), and the matching flow titles (FundFlow.tsx:72, RailFlow.tsx:166, PlaceFlow.tsx:166,
   TransportFlows.tsx:119, LinkFlow.tsx:96, HotelFlow.tsx:286). → Use "Edit" everywhere (the CONVENTIONS example); keep "Set up" only for built-in placeholders.
2. **Delete verb.** "Delete" on guests, households and seating, but "Remove" for the same act on travel (HotelFlow.tsx:335, LinkFlow.tsx:126). → "Delete".
   Revoke, Withdraw and Unpublish are different domain acts and are fine.
3. **Danger buttons must name the thing** (CONVENTIONS: "Delete Ada Lovelace"). These do not: 'Unpublish' SeatingFlows.tsx:403, 'Withdraw the benefit'
   TransportFlows.tsx:170, 'Revoke the link' InvitationFlows.tsx:260, 'Reset access' GuestFlows.tsx:223, 'Merge' GuestFlows.tsx:299,
   'Reject duplicates' DuplicateClusters.tsx:175. → e.g. `Revoke ${who}’s link`, `Merge ${name} into ${keep}`.
4. **Save buttons.** Most screens say "Save <thing>" / "Add <thing>". Outliers: bare 'Save' in FundFlow.tsx:77, RailFlow.tsx:171 and
   TransportFlows.tsx:124, and 'Save changes' in ContentFlows.tsx:262 and RegistryFlow. → "Save fund", "Save Venmo", "Save ride benefit", "Save record".
5. **The same RSVP state is worded three ways.** RSVP says "attending / declined / no answer" (rsvp/page.tsx:128, lowercase); seating says
   "Coming / Not coming / No answer" (seating/page.tsx:201). Pill case is mixed across the console too: sentence case on guests, households and gifts;
   lowercase on rsvp, jobs, flags, audit and content ("placeholder"). → One label map for RSVP status, and sentence case for every Pill.
6. **Sub-nav goes in the primary-action slot.** ai/page.tsx:33, concierge/page.tsx:65, media/page.tsx:44, media/import/page.tsx:19 and
   media/duplicates/page.tsx:16 pass `<SubNav>` as `actions`. It sits top-right on AI but wraps below the lede on media, and it
   takes the place where every other screen puts its one primary button (media/import's "Import a delivery" is pushed into the body).
   → Add a `subnav` prop to ConsolePage rendered in one fixed place (under the title), and keep `actions` for the primary button.
7. **RSVP screen shape.** Four header buttons (rsvp/page.tsx:51-62): three exports and a view toggle as ghost pills, where guests puts exports
   as links in `FilterBar extra` (guests/page.tsx:57-58). The "Show notes" toggle is a filter. The lede shows a raw enum:
   "RSVPs are closed (lifecycle)" (:48). The screen does not show the deadline, which events does ("no deadline set yet").
   "Every answer" rows have no actions cell, so every correction starts by picking the guest again. At 390 the Answer column is off-screen (column order Event, Household, Guest, Answer).
   → Exports as FilterBar links, the lede states open/closed plus the deadline, a quiet "Change answer" per row, and Guest and Answer as the first columns.
8. **Lifecycle puts internals in the main path** (CONVENTIONS §5). There are raw state enums (SAVE_THE_DATE, RSVP_OPEN) as values, pill and select
   options (lifecycle/page.tsx:47-51, 78, 113-117), "By: system · seed", and a Request id plus `k=v` metadata in the history table (:139-146).
   The screen has no `flow-details`. → Human labels for states; move request ids and metadata into a closed `<details className="flow-details">`.
9. **Media bulk toolbar is inconsistent with itself.** With nothing selected, Approve, Flag and Prepare are aria-disabled, but Reject and Delete open
   a danger sheet titled "Delete items" with body "Nothing is selected" and a red "Delete" button (ModerationQueue.tsx:312-342).
   → Every bulk action should behave the same way (the kit's readyHint), and the sheet title should name the count.
10. **Dates in four formats.** `<Day>` "Sep 27", `<Stamp>` "Sep 27, 2026, 16:10:02 CDT" (seconds, on content and lifecycle), the invitations-only
   DAY formatter (invitations/page.tsx:32), and raw ISO "2026-09-27T21:10:02.957Z" on flags (flags/page.tsx:76). → Day in lists, Stamp without seconds in logs, never raw ISO.
11. **Terracotta used for status.** `.con-pill--warn { color: var(--ops-accent) }` (console.css:200-202) paints "Not confirmed yet" ×3 on events,
   "From the brief" and "Details to confirm" on travel, and "Built-in placeholder" ×2 on reservations. CONVENTIONS says terracotta is only for links;
   DESIGN.md says more than two per viewport means it has stopped being an accent. → Warn tone in ink with a dashed or double hairline, or sage.
12. **DataTable hairline bugs on every table.** The caption rule stops at 62ch (console.css:77-84, `max-width` and `border-bottom` on the same box).
    The last row's `<th scope="row">` keeps its bottom border because console.css:66 resets only `td`, which leaves a short stray line under the first column.
    → Put the rule on the table, not the caption, and reset `tbody tr:last-child th` too.

## Consider
- The focus ring is 3px terracotta across the console (flow.css:351,413,486,661; ops.css:202). DESIGN.md specifies 2px `secondary` with a 2px offset.
  It is at least consistent; decide which one is right and write it down.
- Two empty-state styles with different widths: `.flow-empty` (62ch) and `.con-empty-note` (full width). Transport and concierge show both on one screen.
- Flags draws gates as bordered cards (`.con-gate`) holding a boxed notice. That is the only card pattern outside gifts' status box.
- Hand-rolled quick action: SuggestionReview.tsx:101-121 "Publish as written" should be a `QuickAction` (same busy/done announcement).
- Destructive coverage is uneven. Events, notices, reservations, gift links and content records have no delete or archive flow. That may be intended; state it in CONVENTIONS if so.
- Title punctuation: curly quotes in FundFlow.tsx:72 and EventFlows.tsx:543, bare names elsewhere.
- em-dash advisory: rsvp (46, mostly empty-cell dashes) and lifecycle (9). These are copy notes, not failures.

## What is working (keep)
- One sheet for every task: the same 612px dialog, step bar, "Step n of m", heading focus, and sentence errors on empty Continue (13 of the 16 flows checked).
- The danger anatomy is identical wherever it is used (guests, flags): named title with "?", Consequences box, "Yes, delete X" tick, red named button.
- axe (wcag2a/2aa/21aa/22aa): 0 violations on all 21 pages and all 16 open sheets. No page overflows at 390. Drift detector and stylelint are clean on admin source.
- Guests, households, seating and travel read as one product: name + Pill, one muted line, quiet actions on the right, Technical details closed at the bottom.

## Evidence
- Screenshots and probe data: .impeccable/critique/2026-09-27-admin-console/ (a curated set; `npm run clean` deleted .impeccable/review).
- Rendered detector (impeccable detect through an admin-signed proxy; the repo's `slop:detect:rendered` signs in as a guest and sees only the gate): 390: 66 findings, 1280: 85.
  Rules: 139 text-occlusion (all the closed admin index), 4 heading-rhythm (gifts), 2 low-contrast (media), 4 em-dash (notes), 2 line-length (1280, travel/gifts; not reproduced on a rerun of those routes).
- `node scripts/check-design-drift.mjs` on admin source: 0. design:lint: 0 errors or warnings. stylelint on admin CSS: clean.
- axe: 0 serious or critical, pages and sheets.
- Flows opened: create on guests, events, rsvp, seating, travel, transport, reservations, invitations, gifts, lifecycle, content, media/import;
  danger on guests (Delete), flags (Switch off), media (Delete). Seating, travel and invitations have no danger target in the seed data, so those were reviewed in code.

Next command: `/impeccable polish /admin/content`, then a wording pass over the Edit/Delete/Save verbs across the flow files.
