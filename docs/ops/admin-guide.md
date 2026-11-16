# Admin console guide

For Sara, Tyler and whoever they give an admin account to. The console is at
`/admin`. It is not part of the guest site: it carries no design theme, is
`noindex`, and every page refuses a guest session outright.

Nothing in here needs a developer. Everything a launch waits on — the content
in `docs/content/backlog.md`, the room block, the registry — is entered through
these screens.

## Getting in

1. Your email address must be in `ADMIN_EMAILS`, or an existing owner must have
   granted you a role on `/admin/guests`.
2. Click **Sign in** (top of every page, last item in the Menu on a phone,
   and in the footer), then **Sara or Tyler? Sign in to manage the site** —
   or go straight to `/sign-in/admin` — and ask for a code. It arrives by email in a
   deployment; in local development it lands in the dev inbox at
   `/api/dev/inbox` and is printed to the server log.
   A deployment can only send codes once it has an email service:
   Authorize `resend/wedding` in Vercel Connect, then set `RESEND_CONNECT_USER_ID` and `EMAIL_FROM` in Vercel (see `docs/ops/environment.md`).
   Without them the sign-in page says it can't send
   codes yet, for every address alike, rather than claiming one is on its way.
3. Anything that changes money, identity or publication asks you to prove it is
   still you (a fresh code or your passkey) if your session is more than five
   minutes old. That is deliberate — see "Step-up" below.

## The three roles

Roles are additive; an account can hold more than one.

| Role | Can | Cannot |
|---|---|---|
| **owner** | everything | — |
| **planner** | content, guests, households, invitations, events, RSVP, seating, lifecycle, audit | media moderation, AI diagnostics, provider configuration |
| **moderator** | media queue, audit | anything about guests, content or lifecycle |

Give a vendor or a helper the narrowest role that lets them do their job. A
photographer's assistant clearing the upload queue is a **moderator**; they will
not see a guest list, a dietary need or an address.

## Finding your way

Every screen is one click away in the rail on the left (a drawer behind the menu
button on a phone). The bar at the top says where you are.

- **Jump to or ask** (`Ctrl K` / `⌘ K`, or `/`): type part of a screen's name
  and press Enter to open it, or type a question and press Enter to ask it.
- **The small ⓘ beside a heading** opens the sentence that explains that screen
  or section. It is closed by default; the screens show the work, not the manual.

## The screens

### Start here

| Screen | What it is for |
|---|---|
| `/admin` (Overview) | What needs you today, first. Then five figures (what guests see, replies, visits, errors, stuck jobs), each a link to the screen that owns it; the week's visits; replies by event; recent changes. A figure you may not read is simply not drawn. |
| `/admin/assistant` | Ask in your own words: "How many guests have replied?", "Who visited this week?", "What errors did guests hit?", "Open RSVPs". Each answer is a small live dashboard read from this site's own records, as your role allows, with follow-up questions under it. See [The assistant](#the-assistant). |

### Running the wedding

| Screen | What it is for |
|---|---|
| `/admin/lifecycle` | Moves the site between its nine states (Teaser → Save the Date → Invitations Open → RSVP Open → RSVP Closed → Wedding Week → Wedding Day → Post Wedding → Archive). Every public page's navigation and copy follows this. Preview a state before publishing it. |
| `/admin/content` | Every sentence on the public site that is not code: story sections, adventures, recommendations, itineraries, FAQ answers, venue notes. This is where a `TODO(Tyler & Sara)` placeholder becomes a real fact. |
| `/admin/details` | Dates and facts that show on several pages: the wedding date, the venue's name and address, the reply-by time, each event's time and room, the room block, valet. Each row says what the site says now and every page that prints it. The date, venue, reply-by time and valet lines are changed right there, in one step and a check; the rest link to the screen that owns them. **To decide** marks what guests still read as "to be confirmed"; **Out of step** marks a fact whose copy in the code says something different. |
| `/admin/events` (Schedule) | The weekend day by day, each day in the order things happen: an event shows its time (or "Time not set"), its room, and what is still to decide. Also the menu per event, who is invited to what, the RSVP window, and dashboard notices. |
| `/admin/guests`, `/admin/households` | The guest list, household membership, who manages whose RSVP, admin roles. |
| `/admin/guests/sheet` | Sync the planning spreadsheet (paste the Guests tab or pick its downloaded file), see what the copy changes, then settle what differs from the site: lines to add as households, households whose head counts disagree, households the sheet does not mention. See `docs/ops/guest-sheet.md`. |
| `/admin/invitations` | Issue and revoke invitation links. A revoked link stops working immediately; the guest is told a new one is coming, not that they did something wrong. |
| `/admin/rsvp` | Every answer, meal choice and need, with the RSVP window's open/closed state and deadline. |
| `/admin/seating` | Tables, assignments and the publication boundary. **Nothing about seating reaches a guest until you publish it** — before that, a guest asking is told the chart is not published, not that they have no seat. |

### The things guests send you

| Screen | What it is for |
|---|---|
| `/admin/media` | The upload queue. Everything a guest uploads waits here until it is approved. Approve, reject or delete; nothing appears in the public gallery otherwise. |
| `/admin/gifts`, `/admin/reservations`, `/admin/transport`, `/admin/travel` | The registry links, restaurant handoffs, ride benefits and travel recommendations you offer. All of them link out to the vendor who owns the transaction — this site never takes a payment. On Gifts you also set where gifts of money go: your own Venmo username, PayPal.Me name, $Cashtag, Zelle email or phone, and a mailing address for checks. Enter just the name; the site builds the link. A check also needs the name it is made out to. The four funds (honeymoon, home, adoption, next adventures) are built in; save one with the same id to reword or hide it, and up to 12 funds in all. A field you leave empty when saving keeps what it had. Guests pay no fee from a bank account or app balance, and the money lands in your accounts, never here. |

### Diagnostics

| Screen | What it is for |
|---|---|
| `/admin/providers` | Which external systems are live and which are running on their mock, and exactly what each is missing. The same information as `docs/ops/activation-matrix.md`, read from the running process. |
| `/admin/flags` | Feature flags, and the readiness switches for the two legal gates. |
| `/admin/audit` | Who did what, when. Every administrative action and every external handoff is recorded. Codes, one-time passwords and the text of a guest's dietary needs are never in here. |
| `/admin/sessions` | One row per visit: who (when signed in), the pages they opened, how long, on what kind of device, and any error they met. Open a row to see the visit page by page. |
| `/admin/errors` | What broke for visitors, grouped so one fault seen forty times is one row, with the pages it broke on and a session that hit it. |
| `/admin/jobs`, `/admin/metrics` | Background work, and the timings and counters the site records about itself. |
| `/admin/ai`, `/admin/concierge` | The concierge's search index and answer traces. |

## Step-up

A session older than five minutes is asked to re-prove itself before an action
that is hard to undo: publishing seating, revoking an invitation, deleting an
event, changing an admin role, anything that hands out a ride voucher. A code or
a passkey clears it for the next five minutes.

This is not friction for its own sake. An admin session left open on a laptop at
a venue is the most likely way this site gets misused, and the five-minute
window is the difference between someone reading a screen and someone changing
the guest list.

## Opening the RSVP one part at a time

A reply has four parts — **who is coming**, **bringing a guest**, **meals**, and
optional **dietary and access notes** — and each opens on its own. Guests see
all of them on `/rsvp` as a list: what is done, what is next, and what "opens
later", so nobody is surprised when meals arrive a month after they said yes.

| Part | Opens when | Held shut by |
|---|---|---|
| Who is coming (and notes) | the RSVP window is open | `FLAG_RSVP_ATTENDANCE=off` |
| Bringing a guest | the window is open, for invitations that include one | `FLAG_RSVP_PLUS_ONES=off` |
| Meals | the window is open, a menu is published in `/admin/events`, **and** `FLAG_RSVP_MEALS=on` | ships **off** until the menu is set |

Attendance and plus-ones are on by default. **Meals ship off**: guests who reply
now see meals as "opens once the menu is set" and are not asked. When the menu
is set, publish it in `/admin/events` and deploy with `FLAG_RSVP_MEALS=on`;
`/rsvp` then asks those guests for their meals alone — their attendance is never
asked again or changed. To hold plus-ones back too, deploy with
`FLAG_RSVP_PLUS_ONES=off`. `/admin/flags` shows what is in effect.

Publishing a new menu marks earlier meal choices "the menu changed — choose
again" on the guest's list; nothing else about their reply moves.

## Two things to be careful with

**Revoking an invitation** invalidates the link for the whole household. Anyone
mid-claim is stopped. Issue the replacement before you revoke, so the message
you send them is "here is your new link" rather than "sorry".

**Publishing seating** is visible immediately to every guest with a table. It
can be unpublished, but people will have seen it. The preview shows exactly what
a guest sees.

## The assistant

The assistant answers from records, not from a model's memory. For each question
it works out which records the question is about, reads them through the same
checked doors the screens use (so your role limits an answer exactly as it limits
a screen, and every read is in the audit trail), and lays the answer out as a
small dashboard. Under each answer, **How this was answered** lists what was read.

- **It changes nothing by itself.** When you ask for a change ("Open RSVPs",
  "retry the stuck job") the answer contains a *Proposed change*. **Review** shows
  what it does; nothing happens until you press the button that names the act.
  Publishing a lifecycle state and retrying a job can be confirmed there; every
  other change is made on its own screen, which the answer links to.
- **No AI service is called.** In Chrome or Edge with the browser's built-in
  model, that model (on your own device) may choose a view for a question the
  site could not read and may reword the one-line summary; a reworded line is kept
  only if every figure in it is a figure from the records. In any other browser
  the site words the answer itself.
- The time-window control on an answer (24h, 7d, 30d) re-reads the figures in
  place. Answers stay on the page until you press **Clear** or close the tab.

## Telemetry

The site keeps its own record of visits and of the errors visitors hit. Nothing
goes to a third party; it lives in two tables (`visit_sessions`, `visit_events`)
and is read back through four admin capabilities behind `admin_integrations`:
`admin_site_traffic`, `admin_list_sessions`, `admin_session_detail` and
`admin_site_errors`.

**Recorded.** A session is one browser tab's visit: a random id the tab makes up
and keeps in `sessionStorage` (no cookie, nothing that outlives the tab). For
each session: when it started and was last seen, phone, tablet or desktop, the
browser family (Chrome, Safari, Firefox, Edge, Other), the first and last page,
and, once the visitor signs in, which guest it is. For each event: a page view
(the pathname), a web vital (LCP, CLS, INP) or an error (name, message, top
frames). Errors the server hits while answering a request are recorded too, tied
to no session.

**Never recorded.** IP addresses (the address is the rate limiter's key and is
not stored), location, the User-Agent header, referrers, query strings and
hashes, request headers and cookies. Paths that carry a secret are collapsed
(`/i/<token>` is stored as `/i/[token]`, likewise `/invite/…` and `/s/…`), and
emails, tokens and long numbers are redacted from error messages before they
are stored (`src/domain/ops/telemetry-sanitize.ts`).

**Do Not Track.** A browser that sends `Sec-GPC: 1` (Global Privacy Control) or
`DNT: 1` gets no session, no page views and no vitals. An error it reports is
still kept, attached to no session: that is a fact about the site, not about
the visitor.

**Retention.** The hourly `housekeeping.purge` job deletes sessions and events
older than `TELEMETRY_RETENTION_DAYS` (default 90).

**Switching it off.** `TELEMETRY=off` records nothing: the beacon is not
rendered, `POST /api/telemetry` answers 204 without reading the body, server
errors are not recorded, and `admin_site_traffic` reports `recording: false` so
an empty chart is not read as an empty site. What was already recorded stays
until it ages out.

On the test server (`SEED_TEST_FIXTURES=1`) a week of clearly synthetic visits
is seeded so the screens have something to draw
(`src/db/seed/telemetry-fixtures.ts`).

## Where the truth lives

- What still needs a decision from Sara and Tyler: `docs/content/backlog.md`,
  and the plain-language version at `docs/content/for-sara-and-tyler.md`.
- What is switched off and what turns it on: `docs/ops/activation-matrix.md`.
- What is recorded about whom, and why: `docs/architecture/threat-model.md`.
