# Admin console: how a screen changes things

Every `/admin` screen uses this kit the same way. `/admin/gifts`, `/admin/guests` and
`/admin/households` are the references; copy their shape.

## The four patterns

| What the admin is doing | Use | Never |
|---|---|---|
| Creating or editing a record | `AdminFlow` in a sheet: one question per step, a review or preview step last, one capability call on save | A long form beside the list, a `?edit=` reload, typing an id |
| Deleting, revoking, resetting, merging, unpublishing | `AdminFlow tone="danger"`: one step, `<Consequences>` saying what happens and whether it can be undone, a `CheckField` that confirms it, a red button that names the act ("Delete Ada Lovelace") | A red button and a checkbox repeated down every row |
| A one-click change that is easy to reverse (show/hide, move up/down, retry) | `QuickAction` | A form per row |
| Searching or filtering what is shown | `FilterBar` (a GET form) | A flow: filters change the view, not the data |

## Page layout

1. `ConsolePage` with a short `lede`. The screen's main create action goes in `actions`
   (top right): one primary button per screen. A family's `SubNav` (media, intelligence) goes in
   `subNav`, never in `actions`.
2. A `FilterBar` above the list when the list can be searched.
3. The things the screen manages as a `RecordList` of `RecordRow`s: name and state (`Pill`) first,
   one muted line of details, row actions on the right as quiet text buttons (`variant="quiet"`,
   or `variant="danger"` for destructive ones), each with `accessibleName` ("Edit Ada Lovelace").
4. Dense data read across columns (logs, queues, counts, answers) stays a `DataTable`; its
   actions cell holds the same quiet triggers.
5. Raw ids, internals and troubleshooting tables go in a closed `<details className="flow-details">`
   at the bottom, never in the main path.

## Words (the same everywhere)

| Where | Say | Not |
|---|---|---|
| A row's edit trigger | **Edit** (`accessibleName`: "Edit Ada Lovelace"). **Set up** only for a built-in placeholder nobody has saved yet | Change, Modify, Manage |
| A row's destructive trigger | **Delete** to remove a record. The act's own verb when it is not a deletion: **Revoke**, **Withdraw**, **Replace**, **Unpublish**, **Cancel**, **Reject**, **Reset access** | Remove |
| A danger flow's button | The verb and the thing: "Delete Ada Lovelace", "Revoke the Lovelace link", "Cancel the reminder job" | "Delete", "Confirm", "Yes" |
| A create/edit flow's button | "Add a guest" / "Save guest", "Add a fund" / "Save fund" | bare "Save", "Submit", "OK" |
| Flow titles | Verb and name, no quotes: "Edit Our honeymoon", "Delete the Garden table" | “Edit ‘Our honeymoon’” |
| RSVP answers | **Coming**, **Not coming**, **No answer yet** | attending, declined, yes/no, raw enum values |
| Status pills | Sentence case, a state in plain words ("Shown", "Needs a decision") | lowercase, raw enum values (`private`, `RSVP_OPEN` outside Technical details) |
| Dates and times | `Day` / `Stamp` / `formatStamp` from `_components/console` (Chicago time) | raw ISO strings, `toLocaleString()` |
| Required fields | A sentence saying what to enter ("Give the record a title.") | "Required." |

## Inside a flow

- Titles are verbs about the thing: "Add a guest", "Edit Ada Lovelace", "Delete the Garden table".
- Two to four steps. Group fields by the question they answer ("Who", "How to reach them",
  "Check and save"). A one-field change is a one-step flow.
- Every field has a visible label and a hint when the format is not obvious. Optional fields say so.
  Values are strings in the flow; convert (`Number`, ISO dates, `null` for empty) in `submit.input`.
- `ready` + `readyHint` on any step that needs something before Continue: the button is never a
  silent disabled control.
- The last step shows what will be saved: `ReviewList`, or `GuestPreview` when guests will see it.
- `load` fetches the full record when an edit opens; the page only lists summaries.
- `submit.result` keeps the sheet open on a Done panel for something shown only once (an
  invitation link, an import's counts). Otherwise the sheet closes, the trigger announces
  `submit.success`, and the page refreshes from the server.
- Capabilities with `stepUp` need nothing extra: the flow keeps the draft across `/step-up`.
- Drafts are kept on the device (`sessionStorage`) for create/edit flows; `danger` flows keep none.
  A flow whose answers must never sit in the browser (ride codes, a pasted guest list) is `secret`:
  no draft at all, and a step-up detour asks for them again instead of keeping them.
- A list that can run to hundreds of rows (guests, households, seats) shows fifty at a time:
  `paged(rows, searchParams.page)` and `PageLinks` under the list. Search narrows it first.
- A picker every row shares (households, guests, tables) goes to the browser once, through
  `ListsProvider` around the list, and each row's flow reads it with `useList`. Passed to every row,
  it makes the page grow with the rows times the options.
- Up and Down on a hand-ordered list are `QuickAction`s whose calls come from `moveCalls` (`order.ts`),
  given the whole list as shown, so rows that share a place are renumbered rather than left to chance.

## Visual rules

Foundation tokens only (root `DESIGN.md`). One filled button per viewport. Terracotta only for
links; `--color-error` for destructive triggers and buttons. Hairlines, not cards or shadows.
`npm run design:drift` and `npm run lint:css` must stay clean.
