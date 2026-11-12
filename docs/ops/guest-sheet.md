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
Addresses, emails, phones, dietary restrictions and notes are never mapped by the parser
(`src/domain/guests/sheet.ts`): they reach the server in the pasted text, are dropped there, and are
never stored, shown, logged or exported. The list ends at the first blank row, because the sheet
keeps its own tallies below one; a blank spacer row in the middle of the list hides the lines below
it, so keep the list contiguous.

Reading and saving are admin only (`admin_guest_sheet`, `admin_upload_guest_sheet`, both behind the
`admin_guest_ops` entitlement) and are never offered to the concierge or WebMCP.
