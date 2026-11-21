# The planning sheet in the admin console

`/admin/guests/sheet` (**Guest sheet** in the rail) holds the couple's planning-sheet guest list
(the **Guests** tab of their wedding spreadsheet) beside the site's own guest records. The sheet
stays the place the list is edited. The console keeps the latest **copy** of it that an
administrator saved and compares that copy with the site; nothing reads Google live, so there is no
service account, key or environment variable to set up.

## Syncing

1. In the sheet, open the Guests tab and either copy everything (Ctrl/Cmd + A, then Ctrl/Cmd + C) or
   download it (File, Download, Comma-separated values).
2. On **Guest sheet**, choose **Update from the sheet**, then paste, or pick the downloaded file.
3. **Check it** shows, before anything is saved: what this copy changes against the last one (new
   lines, removed lines, changed head counts) and how it stands against the site.
4. Save. Each save is kept (`guest_sheet_copies`); the newest is the one compared. Saving also adds
   everyone a line names to the guest list and links each line to its household (see "The sheet as
   the guest list" below); nobody is removed or changed.

## Reconciling

After a sync the screen lists what the sync left for a person:

| List | What it means | What you can do |
|---|---|---|
| On the sheet, not on the site | A line the sync left alone: nobody on it could be read as a name, or two guests already answer to one | If a household's name is close, **It is …** links the line to it. **Add household** creates an empty household named after the line; add its people on Guests. |
| Head counts differ | The line and its household disagree on grown-ups (adults and plus-ones together) or on children | Open the household and add or remove people. A head the sheet counts and does not name is kept on the site as a plus-one, which is why grown-ups are compared together. |
| On the site, not on the sheet | A household no line answers to | Open the household: it was added by hand, renamed on one side, or taken off the sheet. |

A line is matched to a household by a saved link first, then by name read loosely ("The Fitzgerald
Family" is "Fitzgerald"). The sync saves the link for each household it finds or makes, and it is
what keeps a line and its household together when either is renamed; **Matched lines** lists them
and can unlink. The comparison reads the same lines the sync does: the sheet's own tallies under
the list are left out.

## What is kept

Each line's name, adults, kids, plus-ones, whose guest, group, priority, and the save-the-date,
invite, RSVP, table and menu columns. The names are the tab's first column whatever its header says.
Addresses, emails, phones, dietary restrictions and notes are never mapped by the copy's parser
(`src/domain/guests/sheet.ts`): they reach the server in the pasted text, are dropped there, and are
never stored in the copy, shown, logged or exported. (An email on a line does become that guest's
sign-in address on their guest record: see "The sheet as the guest list" below.) The list ends at the first blank row, because the sheet
keeps its own tallies below one; a blank spacer row in the middle of the list hides the lines below
it, so keep the list contiguous.

Reading, saving, comparing and linking are admin only (`admin_guest_sheet`, `admin_upload_guest_sheet`,
`admin_guest_sheet_sync`, `admin_link_sheet_line`, `admin_add_household_from_sheet`, all behind the
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
  dietary needs and notes are still never read.
- **Phone is read too** (`phoneOwnerIndexes`): numbers in the Phone cell, separated by `;`, `/`
  or `,`, go to the people on the line in the order they are named (`5551110000;5552220000` on
  "Lee and Karen Kendrick" is Lee's, then Karen's). A single number on a line of two is the first
  person's, the household's own. A number already on another guest is left alone. Phone sign-in
  texts a code to the number, so only whoever holds that phone can use it.
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

## Who cannot sign in

The console's **Overview** puts households nobody can sign in for at the top of **Needs you**, and
lists them in a full-width panel above everything else (`admin_guest_reach`,
`src/domain/guests/reach.ts`). A household is on it when not one grown-up in it has an email or a
phone on their guest record (the record's own columns or its contact rows); children and merged
records do not count. The list is ordered by the sheet line's **Priority** (1 first), then by name,
and shows the side; each name opens the household on **Guests**, where an email or mobile number can
be added. It shows names and counts only, never a contact detail, and is admin only.
