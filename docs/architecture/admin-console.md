# The admin console: shell, dashboards and the assistant

How `/admin` is put together, and the rules the assistant runs under. For what
each screen is for, see `docs/ops/admin-guide.md`; for how a screen changes
things, `src/components/admin/flow/CONVENTIONS.md`.

## The frame

`src/components/admin/shell` is the frame every admin screen sits in: a rail
(every screen, grouped), a bar (where you are, the command palette, Ask), and
the screen. All three read one list, `src/app/(admin)/admin/_components/sections.ts`.
A screen without an entry there cannot be found; `tests/e2e/admin-console.spec.ts`
walks the rail and requires every link to resolve.

A reader who is not an administrator gets no frame: each page shows its own
sign-in gate (`ConsoleGate`).

Explanations are on demand. `ConsolePage`'s `lede` and `Section`'s `note` render
as an `About` disclosure beside the heading, closed by default.

## Telemetry

Visits, errors and page speed are recorded by the site itself
(`src/components/telemetry`, `POST /api/telemetry`, `src/domain/ops/telemetry.ts`)
and read through four capabilities: `admin_site_traffic`, `admin_list_sessions`,
`admin_session_detail`, `admin_site_errors`. What is and is not kept is in
`docs/ops/admin-guide.md` under Telemetry. The console's own pages are not
recorded as views.

## One place for shared facts

`/admin/details` reads `admin_site_details`, which builds its list in `src/domain/site-details`: for
each fact, its value, the pages that print it, and how it is changed (a capability call the screen
makes in place, or a link to the screen that owns it). Where the code keeps its own copy of a fact
(the wedding date constant the trip planner reads, the address and valet sentence in
`src/domain/travel/facts.ts`, the room-block dates in `stay-copy.ts`), the copy is compared with the
record and the fact is marked out of step when they differ. The wedding date is also out of step when no event
is on it: the date was moved and the schedule was not. Adding a shared fact is adding it to
`buildSiteDetails`; making a page follow one is making it read the record.

`admin_update_site_details` is the one writer of `site_settings` after the seed.

## The schedule

`/admin/events` groups events by day and orders each day by start time (`src/domain/events/agenda.ts`).
Events with no time follow, in their hand-set order; Up and Down move an event among those only.
`listEvents` returns the same order (day, start time, then `sortOrder`), so guests read the events
in the order the Schedule shows them. The event flow takes a date and times of day, so a start
cannot land on a different day from the event's own date.

## The assistant

One capability, `admin_assistant_answer` (`src/capabilities/ops/admin_assistant.ts`),
answers a question in three steps, none of which calls a model:

1. **Route** (`src/domain/admin-assistant/intent.ts`). Words in the message point
   at one of a fixed list of views (visits, sessions, errors, replies, a guest,
   lifecycle, jobs, metrics, audit, "what needs me", where something is edited).
   It decides which records to read. It never produces a fact.
2. **Gather.** The handler invokes the read capabilities that view needs, each
   through the pipeline as the signed-in administrator. An administrator's role
   limits an answer exactly as it limits a screen, and each read is audited. A
   refused read is reported as "not part of your access", not as an empty chart.
3. **Compose** (`compose.ts`). The answer is written as an OpenUI Lang program
   for the console's component library. Figures are either literals from the
   gathered records or `Query("<capability>", …)` statements whose default is
   that same data. Text from records is always written as a JSON string literal.

The page (`src/components/admin/assistant`) renders the program with
`@openuidev/react-lang`.

### The library

`components/admin/assistant/openui` is the dashboard subset of the Intelligent UI
vocabulary (open-intelligent-ui, thesysdev, MIT): the same component names and
positional arguments (`Col`, `Row`, `Grid`, `Card`, `Title`, `Text`, `Caption`,
`Badge`, `Link`, `List`, `ListItem`, `Button`, `SegmentedControl`, `Select`,
`Table`, `Chart`) and its `@functions`, ported with the licence beside them, drawn
with the console's own tokens. `Proposal` is the one addition.

### What a program can reach

Two short lists in `src/domain/admin-assistant/catalog.ts`:

| List | What it bounds | Enforced |
|---|---|---|
| `READ_TOOLS` | The capabilities a program's `Query(...)` may call | In the browser (`openui/host.tsx` builds the tool provider from the list) and then by the pipeline for the caller |
| `PROPOSABLE` | The capabilities a `Proposal` may name | In the browser (a proposal for anything else renders no button) and then by the pipeline, including each capability's own confirmation rule |

A `Proposal` does nothing until a person presses **Review** and then the button
that names the act. Publishing a lifecycle state goes through
`draft_lifecycle_transition` first, and the publish call carries the token that
draft issued, the same as on `/admin/lifecycle`.

### The browser's model

No hosted model is used (`CLAUDE.md`, "Secrets & accounts"). Where the browser
has a built-in model (`src/lib/ai/browser-model.ts`), it may do two things, both
in `src/domain/admin-assistant/writer.ts`:

- **Choose** a view when the router scored nothing. It is shown the list of views
  and the question, and replies with one line naming a view. A name off the list
  is discarded; the capability's input schema refuses one too.
- **Say** the summary in its own words. It is given the facts the answer was
  composed from; `acceptSaid` keeps its sentence only if every number in it is a
  number from those facts, and otherwise the composer's sentence stays.

Without a model every answer still arrives. Each answer's "How this was answered"
says which records were read and whether a model worded it.

## Tests

| What | Where |
|---|---|
| Router, composer, shaping, the model's guards | `tests/unit/admin-assistant/` |
| Every view's program through the real OpenUI renderer; the two lists; link safety | `tests/ui/admin-assistant.test.tsx` |
| The capability through the pipeline: role limits, proposals change nothing | `tests/integration/admin-assistant.test.ts` |
| The rail, the palette, a proposal's review step, axe on every screen | `tests/e2e/admin-console.spec.ts` |
