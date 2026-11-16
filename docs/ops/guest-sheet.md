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
4. Save. Each save is kept (`guest_sheet_copies`); the newest is the one compared.

## Reconciling

After a sync the screen lists what is left to do, and nothing is applied in bulk:

| List | What it means | What you can do |
|---|---|---|
| On the sheet, not on the site | A line no household answers to | **Add household** creates an empty household named after the line. If a household's name is close, **It is …** links the line to it instead. |
| Head counts differ | The line and its household disagree on adults or children | Open the household and add or remove people. Plus-ones are not compared: the site may hold one as an allowance on the invitation. |
| On the site, not on the sheet | A household no line answers to | Open the household: it was added by hand, renamed on one side, or taken off the sheet. |

A line is matched to a household by a saved link first, then by name read loosely ("The Fitzgerald
Family" is "Fitzgerald"). A link is what keeps a line and its household together when either is
renamed; **Matched lines** lists them and can unlink. The sheet counts heads and names nobody, so
the people in a household are still added on Guests, where an invitation needs a name.

## What is kept

Each line's name, adults, kids, plus-ones, whose guest, group, priority, and the save-the-date,
invite, RSVP, table and menu columns. The names are the tab's first column whatever its header says.
Addresses, emails, phones, dietary restrictions and notes are never mapped by the parser
(`src/domain/guests/sheet.ts`): they reach the server in the pasted text, are dropped there, and are
never stored, shown, logged or exported. The list ends at the first blank row, because the sheet
keeps its own tallies below one; a blank spacer row in the middle of the list hides the lines below
it, so keep the list contiguous.

Reading, saving, comparing and linking are admin only (`admin_guest_sheet`, `admin_upload_guest_sheet`,
`admin_guest_sheet_sync`, `admin_link_sheet_line`, `admin_add_household_from_sheet`, all behind the
`admin_guest_ops` entitlement) and are never offered to the concierge or WebMCP.
