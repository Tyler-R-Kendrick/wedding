# The planning sheet in the admin console

`/admin/guests` shows the couple's planning-sheet guest list (the **Guests** tab of their wedding
spreadsheet) beside the site's own guest records. The sheet stays the place the list is edited.
The console shows the latest **copy** of it that an administrator saved; nothing reads Google live,
so there is no service account, key or environment variable to set up.

## Updating the copy

1. In the sheet, open the Guests tab, select everything (Ctrl/Cmd + A) and copy (Ctrl/Cmd + C).
   A CSV export of the tab (File, Download, Comma-separated values) works too.
2. In `/admin/guests`, under **Planning sheet**, choose **Update from the sheet**, paste, and check
   the line and head counts it shows before saving.

Each save is kept (`guest_sheet_copies`), and the newest one is shown with the time it was saved.

## What is kept

Each line's name, adults, kids, plus-ones, whose guest, group, priority, and the save-the-date,
invite, RSVP, table and menu columns. The names are the tab's first column whatever its header says.
Addresses, emails, phones, dietary restrictions and notes are never mapped by the copy's parser
(`src/domain/guests/sheet.ts`): they reach the server in the pasted text, are dropped there, and are
never stored in the copy, shown, logged or exported. (An email on a line does become that guest's
sign-in address on their guest record: see "The sheet as the guest list" below.) The list ends at the first blank row, because the sheet
keeps its own tallies below one; a blank spacer row in the middle of the list hides the lines below
it, so keep the list contiguous.

Reading and saving are admin only (`admin_guest_sheet`, `admin_upload_guest_sheet`, both behind the
`admin_guest_ops` entitlement) and are never offered to the concierge or WebMCP.

## The sheet as the guest list

Saving a copy also makes the site's guest records agree with it (`src/domain/guests/sheet-sync.ts`),
so that everyone a line names can sign in under their own name:

- **Each person a line names is a guest of their own.** "Bram and Nora Fitzwilliam" is two guests
  under one surname; "Alma Jarvik and Jody O'Brennan" is two under two, and either may sign in with
  Google or Facebook under their own surname, their partner's, or both hyphenated.
- **A head the line counts and does not name** ("Sara Fox", 2 adults) is an unnamed guest of the
  first person on the line. Name them in the sheet later and the same record takes the name.
  Children are counted in the copy and not made into guests.
- **It only adds and completes.** Nobody is removed, merged, moved or renamed to something else, and
  nothing a guest or an administrator entered is overwritten. People already added by hand are found
  by name and not made twice. A guest who is not on the sheet (the couple, the wedding planner) is
  left exactly as they are.
- **Email is the one contact column read**: an address on a line becomes the sign-in address of the
  person it is plainly for (a lone person, or the one whose given name the address contains). One
  that could be either person's stays in the sheet. Addresses, phones, dietary needs and notes are
  still never read.

### Writing a line so its people can sign in by name

| In the sheet | Result |
|---|---|
| `Bram and Nora Fitzwilliam` | Both found by name. |
| `Alma Jarvik and Jody O'Brennan` | Both found, under either surname. |
| `Neal Kendall and Tilly` | Tilly is found as "Tilly Kendall" only. Write her surname if it differs. |
| `Nora (Halloran) Fitzwilliam`, or `Nora Fitzwilliam née Halloran` | Also found under her maiden name. |
| `Mick and Christa`, `Edmund`, `Grandma Winslow`, `Rico Tess's bro` | Not found by name: a first name alone, or a relation, is not enough to sign someone in. They can still sign in with an email or phone on their guest record, or be linked by hand under **Sign-in reviews**. |

The save reports how many lines have someone who cannot be found by name.

Sign-in still waits for the household's invitation to be marked as sent (`docs/social-auth.md`).

## Uploading without the console

The repository is public and the guest list is not, so the list is never committed in the clear. It
can be committed **sealed** (`src/domain/guests/sealed-list.ts`): encrypted to a key that exists
only inside a production build, derived there from the deployment's auth secret.

1. Copy the Guests tab into a file outside the repository (tab-separated, header row first).
2. `npm run guests:seal -- <that file> --source "S+T Wedding, Guests tab"` writes
   `ops/guest-list/guest-list.sealed.json`, sealed to the key in `ops/guest-list/key.json`.
3. Commit it. The next production deploy opens it, saves it as the newest copy and syncs the guest
   records (`db:sync-guest-list`, the last step of `scripts/deploy/migrate-on-deploy.mjs`), and says
   what it did in the build log, in counts.

Every production and preview build prints its sealing key (`guest list: this deployment's sealing
key is …`). It is not a secret: sealing needs only that key, opening needs the deployment's secret.
If the auth secret is ever changed the key changes with it, and a list sealed to the old key is
skipped with a line saying so; put the new key in `ops/guest-list/key.json` and seal again. A list
that will not open or load never fails the build: the site deploys with the guests it had.

