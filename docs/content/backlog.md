# Content backlog — what is not safe to treat as final

Tyler's list, reproduced verbatim as the checklist items. Nothing here may
appear on a page as fact until it is closed. Closing an item means: the
value is added to [`../design/brief.md`](../design/brief.md) §2 with a
source, the `TODO(Tyler & Sara)` is removed from code and copy, and any
operational value gets a provenance record
([ADR-0011](../adr/0011-content-provenance-and-freshness.md)).

Needed-by is the lifecycle state ([ADR-0012](../adr/0012-site-lifecycle-state-machine.md))
in which the fact first renders to guests.

## Couple (Sara + Tyler)

| Done | Id | Item (verbatim) | Needed by | Surfaces blocked | Notes |
|---|---|---|---|---|---|
| [ ] | C-01 | dress code | INVITATIONS_OPEN | The Wedding, FAQ copy, RSVP | One sentence + example outfit per reading (`wedding-site-standards` §4) |
| [ ] | C-02 | final colors/florals/linens/stationery/décor | INVITATIONS_OPEN | The Wedding "what it will look like", theme accents | Planner design materials are the planner's IP — describe, never ingest |
| [ ] | C-03 | officiant/ceremony structure and which community ideas are kept | RSVP_OPEN | The Wedding, Timeline | Ideas in brief §2 are NOT settled: thanking guests at start, quiet couple time, audience acknowledging someone they love, "vows to the community", children drawing "what love looks like" |
| [ ] | C-04 | final invitation count vs 142 universe | INVITATIONS_OPEN | Invitations, Household seed data | Universe: 105 adults + 28 children + 9 plus-ones; planner anticipates 110–160 |
| [ ] | C-05 | kid policies/activities | INVITATIONS_OPEN | The Wedding, RSVP (children rows), Share an Adventure "with kids" | 28 children in the universe |
| [ ] | C-06 | registry provider and choices | RSVP_OPEN | Gifts (provider adapter, ADR-0004) | Language: "help us with our next adventures", never "cash fund"/"donate" |
| [ ] | C-07 | final engagement/proposal story and photos | TEASER | Home teaser, Our Story, Photos & Video | Met at Allison and Jamie's wedding is known; proposal is not |
| [ ] | C-08 | which adventures are public and their copy/photos | TEASER | Our Adventures, Share an Adventure memory layer | Known places: Museum of Ice Cream, Richardson Farm, Michael Jordan's Steakhouse, food tastings, gardening, Madison waterfront, Starved Rock (first "I love you" — trail/date/wording unknown) |
| [ ] | C-09 | permission for third-party AI processing of professional media | POST_WEDDING (before any processing) | Photos & Video AI features, biometrics (ADR-0006) | Written confirmation from Brooke Alaina Photography and Oakhouse Visuals; `PRO_MEDIA_AI_PROCESSING` stays `false` until then |
| [ ] | C-10 | band/DJ and music | RSVP_OPEN | The Wedding, Timeline ("six songs of open dancing" photo coverage), FAQ | References NOT settled: Stella Katherine Cole, Haley Reinhart, Puddles Pity Party, Postmodern Jukebox, Michael Bublé; "Simply the Best" (Billie Anne) noted for the aisle |

## Planner (Bustle & Lace, with CAA)

| Done | Id | Item (verbatim) | Needed by | Surfaces blocked | Notes |
|---|---|---|---|---|---|
| [ ] | P-01 | exact CAA room(s) for ceremony/cocktail/reception | INVITATIONS_OPEN | The Wedding, Explore CAA (your table), Timeline | Do not build around White City because it photographs best; candidates from kit: White City Ballroom, Madison Ballroom, Stagg Court, The Tank |
| [ ] | P-02 | exact times (the spreadsheet timeline is a generic template) | INVITATIONS_OPEN | The Wedding, Timeline, calendar files, WEDDING_DAY "now/next" | Until closed, render "times to be confirmed" with `verifiedAt`, never a template time |
| [ ] | P-03 | CAA room-block rate/URL/dates/room types/cutoff | SAVE_THE_DATE | Travel & Stay block card, Your Weekend benefit | Kit: courtesy block up to 20 rooms subject to availability; two parent upgrades at group rate; all to verify |
| [ ] | P-04 | final alternative hotels | SAVE_THE_DATE | Travel & Stay | Cost-sensitive travellers need a range |
| [ ] | P-05 | Uber voucher amount/geography/validity | WEDDING_WEEK | Transportation, Your Weekend benefit, rides adapter (ADR-0004) | Step-up on redemption (ADR-0001) |
| [ ] | P-06 | final table assignments | WEDDING_WEEK | Your Weekend "your table", Explore CAA floor plan | Published only in WEDDING_WEEK+; per-guest entitlement; never in the repo |
| [ ] | P-07 | current CAA outlet menus/hours/reservation links | SAVE_THE_DATE, re-verified before WEDDING_WEEK | Explore CAA outlets, Share an Adventure "stay inside CAA" | Kit is stale (Milk Room closed Feb 2025; Cherry Circle Room closed Apr 2024); current list on chicagoathletichotel.com: Cindy's, Game Room, Drawing Room, Shake Shack, The Ives, Midōsuji, Fairgrounds, Topgolf Swing Suite; each a record with `verifiedAt` |

## Vendors

| Done | Id | Item (verbatim) | Needed by | Surfaces blocked | Notes |
|---|---|---|---|---|---|
| [ ] | V-01 | final menu/hors d'oeuvres/bar/cake/late-night | RSVP_OPEN | RSVP meal choice, The Wedding, personalized menu cards idea | Food ideas NOT settled: Flavor Tripping, hot-dog ice cream, Esmé, Jeni's Ice Cream, bread as centerpieces |
| [ ] | V-02 | band/DJ and music (vendor confirmation of C-10) | RSVP_OPEN | The Wedding | Vendor not contracted per brief; C-10 holds the couple's choice |
| [ ] | V-03 | permission for third-party AI processing of professional media (vendor side of C-09) | POST_WEDDING | Photos & Video | Photographer retains copyright; couple has personal non-commercial online display rights |

## By lifecycle stage (same items, in the order they block)

| State | Items that must be closed before entering it |
|---|---|
| TEASER | C-07 (at least a teaser line and one photo), C-08 (which adventures are public) |
| SAVE_THE_DATE | P-03, P-04, P-07 |
| INVITATIONS_OPEN | C-01, C-02 (if described), C-04, C-05, P-01, P-02 |
| RSVP_OPEN | C-03, C-06, C-10 / V-02, V-01 |
| WEDDING_WEEK | P-05, P-06, P-07 re-verified |
| POST_WEDDING | C-09 / V-03 before any AI feature on professional media |

## Also unknown (not on Tyler's list, surfaced by the SDLC docs)

| Done | Id | Item | Owner | Needed by |
|---|---|---|---|---|
| [ ] | X-01 | RSVP deadline, save-the-date send date, invitation send date | Couple + planner | scheduled lifecycle transitions |
| [ ] | X-02 | Which Chicago airport(s) to recommend; any shuttle | Couple + planner | SAVE_THE_DATE |
| [ ] | X-03 | Default theme (or random-until-chosen) | Couple | level 03 |
| [ ] | X-04 | Plus-one policy wording (9 plus-ones in universe) | Couple | INVITATIONS_OPEN |
| [ ] | X-05 | Biometric retention period and counsel name (ADR-0006) | Couple + counsel | before `BIOMETRICS_ENABLED=true`, if ever |
| [ ] | X-06 | Special event valet rate and whether it is publishable | Planner / CAA | INVITATIONS_OPEN |
| [ ] | X-07 | How a guest reaches you with a question (one contact fact: address, number, or form). Named twice on a closed `/rsvp` — the closed notice and the site footer both mark the same gap | Couple | any lifecycle state; both guest pages show it today |
| [ ] | X-08 | Whether a guest may see who else is seated at their table. Tablemate names cross household lines by design, and that is what a seating chart is, but it is the one place a guest learns another household's placement | Couple | before seating is published |
