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
  by name and not made twice, whatever their household is called; so is someone whose spelling you
  corrected ("Jon" to "John"), someone you moved to another household, and someone you merged into
  another guest. A guest who is not on the sheet (the couple, the wedding planner) is left exactly
  as they are.
- **What it cannot tell.** A name rewritten beyond a short form or a letter ("Kristofer Mendel" to
  "Christopher Mendel-Hale") looks like a new person, and the sheet's spelling is added beside
  yours: the save counts it as added, and **Merge** puts the two together. Two lines written exactly
  the same are loaded once and the second is reported; tell them apart in the sheet (`Sr.`, `Jr.`,
  a middle name). A line whose people already sit in two households is left alone and reported.
- **Email is the one contact column read**: an address on a line becomes the sign-in address of the
  person on it that it is plainly for: the only person on a line that counts nobody else, or the
  one person the address names (`neal.k@`, `nealkendall@`, or an initial and the surname,
  `bfitzwilliam@`). One that names both or neither stays in the sheet for you to put on the right
  guest; so does one on a line that counts a head it does not name (it may be theirs), and one under
  a name two people on the line share a form of (`chris@` on "Chris and Christine"). A verified
  email signs a guest in on its own, so a wrong guess would sign in the wrong person. Addresses,
  phones, dietary needs and notes are still never read.
- **A line of more than 20 heads** is taken for a tally or a typo, left alone and reported.
- **The list ends at the last line that says whose guest it is** (a side, group or tier). The
  sheet's own tallies under it ("2s", "Declined", "Total") are not households, with or without a
  blank line between.
- **`foundElsewhere`** in the counts is how many people a line names were not in its household and
  were taken to be the guest of that exact name somewhere else (someone you moved). If it is not
  zero and you moved nobody, two different people share a name: add the second by hand.

### Writing a line so its people can sign in by name

| In the sheet | Result |
|---|---|
| `Bram and Nora Fitzwilliam` | Both found by name. |
| `Alma Jarvik and Jody O'Brennan` | Both found, under either surname. |
| `Neal Kendall and Tilly` | Tilly is found as "Tilly Kendall" only. Write her surname if it differs. |
| `Nora (Halloran) Fitzwilliam`, or `Nora Fitzwilliam née Halloran` | Also found under her maiden name. Brackets after the whole name (`Tom Bakewell (boss)`) are a note, not a name. |
| `Ana Ruiz +1`, `Ana Ruiz and guest`, `Mr and Mrs Tom Bakewell` | The person named, and a head counted. |
| `The Bakewell Family`, `Dr. and Mrs. Bakewell` | Nobody is named, so nobody is found by name: write their given names. |
| `Corwin Zarkov Sr.` and `Corwin Zarkov Jr.` | Two people. A profile that says which it is finds that one; one that does not finds neither. |
| `Mick and Christa`, `Edmund`, `Grandma Winslow`, `Rico Tess's bro` | Not found by name: a first name alone, or a relation, is not enough to sign someone in. They can still sign in with an email or phone on their guest record, or be linked by hand under **Sign-in reviews**. |

The save reports how many lines have someone who cannot be found by name.

Sign-in still waits for the household's invitation to be marked as sent (`docs/social-auth.md`).

## Uploading without the console

The repository is public and the guest list is not, so the list is never committed in the clear. It
can be committed **sealed** (`src/domain/guests/sealed-list.ts`): encrypted to a key that exists
only inside a production build, derived there from the deployment's auth secret.

1. Copy the Guests tab into a file outside the repository (tab-separated, header row first).
2. Take the sealing key from the newest **production** build log (`guest list: this deployment's
   sealing key is … (fingerprint …)`). From the build log and nowhere else: a list sealed to a key
   somebody else handed you can be read by them.
3. `npm run guests:seal -- <that file> --key <the key> --source "S+T Wedding, Guests tab"` writes
   `ops/guest-list/guest-list.sealed.json` and prints the fingerprint it sealed to. Check it against
   the build log.
4. Commit it. The next production deploy opens it, saves it as the newest copy and syncs the guest
   records (`db:sync-guest-list`, the last step of `scripts/deploy/migrate-on-deploy.mjs`), and says
   what it did in the build log, in counts.

What is sealed is only what the site reads: names, head counts, the planning columns and the Email
column. Every cell of an address, phone, dietary or notes column is blanked first, so those are not
in the file at all.

**An upload is applied once.** The sealed file stays in the repository and every later deploy reads
it again; a deploy that finds its upload already applied does nothing, so whatever you have done in
`/admin/guests` since (a newer copy, a guest removed, a name corrected) stands. To load the sheet
again, seal it again.

**Uploads apply in the order the sheet was read.** The sealed file carries when the sheet was read
(the moment of sealing, or `--read-at <ISO time>` if you copied the tab out earlier), and the copy
it saves is dated by that. An upload read before the newest copy the site holds, yours pasted in
the console included, is not applied over it.

**A change to the sealed file is a change to the guest list**, and it cannot be read in review:
anyone can seal a file to the public key, so merge a change to `ops/guest-list/` only when you made
it. The build log's counts say what an upload added.

Every production and preview build prints its sealing key. It is not a secret: sealing needs only
that key, opening needs the deployment's secret. A secret shorter than 32 characters derives no key
(the build says so), because the public key would let anyone test guesses at a short one. If the
auth secret is ever changed the key changes with it, and a list sealed to the old key is skipped
with a line saying so: seal again to the new key. A list that will not open or load never fails
the build: the site deploys with the guests it had.

## The wedding planner

She is not on the sheet, and her guest record is yours to keep in `/admin/guests` like anyone's: an
upload never touches it. Every production build says whether her sign-in is in place (`guest list:
wedding planner's guest sign-in: {"records":1,"invitationSent":true,"hasSignedIn":…}`). Nothing is
made for her automatically: her name is on the public site, and a record made by a deploy with its
invitation marked sent would let anyone who read that page sign in under it before she did. With a
record and a sent invitation she signs in under her name as Google or Facebook give it (with or
without her middle name, a short form, her business after her name), or by a verified email on her
record. A profile named only for her business matches nobody unless that name is among her record's
other names; it lands in **Sign-in reviews**, where one approval links it.
