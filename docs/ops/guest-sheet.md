# The planning sheet in the admin console

`/admin/guests` shows the couple's Google Sheet guest list ("Guests" tab) live, beside the site's
own guest records. The sheet stays the place the list is edited; the console reads it, never
writes it, and an edit there shows on the page within `GUEST_SHEET_CACHE_SECONDS` (two minutes by
default). **Refresh from the sheet** on the page skips the wait.

What is read: each line's name, adults, kids, plus-ones, whose guest, group, priority, and the
save-the-date, invite, RSVP, table and menu columns. Address, email, phone, dietary restrictions
and notes are never mapped by the adapter (`src/providers/guest-sheet/parse.ts`), so they cannot
reach the page, a log or an export. The read happens on the server, behind the admin sign-in and
the `admin_guest_ops` entitlement (`admin_guest_sheet`), and is never in a client bundle or a
public route.

The sheet stays private: it is shared with one Google service account, which can only read
spreadsheets shared with it. Publishing the sheet to the web, or "anyone with the link", would
also work technically and is deliberately not supported, because the sheet holds guests' home
addresses and phone numbers.

## Setup (once)

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project and
   enable the **Google Sheets API** for it.
2. **IAM & Admin → Service accounts → Create service account** (no roles needed). Open it, then
   **Keys → Add key → Create new key → JSON**. The download is the only copy of the key.
3. Share the sheet with the service account's email (`…@….iam.gserviceaccount.com`) as
   **Viewer**, unticking "Notify people". Only the sheet's owner, or an editor when sharing is
   allowed, can do this.
4. In Vercel → Project → Settings → Environment Variables, add:
   - `GUEST_SHEET_ID`: the id in the sheet's address, between `/d/` and `/edit`.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: `client_email` from the JSON file.
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: `private_key` from the JSON file, the whole
     `-----BEGIN PRIVATE KEY-----` block. Pasting it with literal `\n` sequences is fine.
   - Optional: `GUEST_SHEET_RANGE` if the tab is not called `Guests`, and
     `GUEST_SHEET_CACHE_SECONDS`.
5. Redeploy. `/admin/providers` shows `guest-sheet` as `google-sheets / live`, and the section on
   `/admin/guests` names the time of the last read.

## When it says something is wrong

| The page says | Meaning |
|---|---|
| not connected yet, with variable names | those variables are unset in this deployment |
| not allowed to read the guest sheet | the sheet is not shared with the service account, or the key was rotated |
| sheet or its tab was not found | `GUEST_SHEET_ID` is wrong, or the tab was renamed (set `GUEST_SHEET_RANGE`) |
| showing the last good read | Google failed just now; the list is from the time shown |
| columns not found | a planning column was renamed in the sheet; the parser matches a few spellings per column |

The list ends at the first fully blank row: the tallies Sara keeps below it ("1s", "Total") are
formulas over the list, not households.
