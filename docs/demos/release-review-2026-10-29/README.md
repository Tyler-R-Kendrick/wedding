# Release review — October 29, 2026

Fresh local browser captures at 390 × 844, using the final working tree described by this commit. Measurements in [observations.json](observations.json) record section order, first-screen dress-code/directions bounds, reply action position and overflow. Screenshots show the actual page, including local development chrome; no compositing or generated mockups.

The baseline is the earlier PR capture at `b68ff15`: [wedding](../sara-feedback/after/wedding.jpg) and [weekend phone](../guest-journey-refinement/after/weekend-mobile.jpg). The wedding baseline is a desktop section capture; compare content order rather than pixel dimensions. The new phone images verify first-screen essentials in all three themes. The refreshed weekend fixture has a partial/open RSVP with demo guests and does not imply actual wedding menu or RSVP availability.

| Wedding theme | Phone screenshot |
|---|---|
| Botanical Deco | ![Wedding essentials first](wedding-botanical-deco-390.jpg) |
| Gilded Hour | ![Wedding essentials first](wedding-gilded-hour-390.jpg) |
| Conservatory | ![Wedding essentials first](wedding-conservatory-390.jpg) |

![RSVP next action before the status list](weekend-reply-390.jpg)

[Existing real guest-journey Webreel recordings](../guest-journey-refinement/README.md) show actual email-code sign-in, map/planning, persisted agenda changes, meal review/confirm, and sign-out gating.

The final ordering check covers partial household A and unanswered household B at phone and desktop sizes. Reply precedes itinerary in reading order; on phones it also precedes it visually. Desktop keeps itinerary left and reply centre. The final phone context explicitly emulates iPhone 14; no production guest data is used.

The captured `touch` media-query field was sampled after full-page screenshot capture. A separate pre-capture phone check confirmed `maxTouchPoints=1`, coarse pointer, DPR 3 and inner width 390; device options and viewport geometry, rather than that post-capture field alone, establish emulation.
