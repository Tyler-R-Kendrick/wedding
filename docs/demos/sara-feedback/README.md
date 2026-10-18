# Sara feedback and guest planning — PR #78

Actual browser evidence for [PR #78](https://github.com/Tyler-R-Kendrick/wedding/pull/78). Before screenshots use `44ec8e6`; after screenshots and the recording use the application code at `f2b2c54`. Later commits add these evidence files only.

## Webreel recording

[Watch the complete recording](guest-experience-webreel.mp4).

[![Excerpt from the recorded guest experience](preview.gif)](guest-experience-webreel.mp4)

The MP4 is one complete take of the working site, captured with **Webreel 0.1.4 (`@webreel/core`)**, with its cursor compositor. Playwright supplies native browser input and checks the results. The GIF is an excerpt of that same take. The address strip identifies the actual local URL in every frame; it is a recorder overlay, not part of the application.

The recorded browser signs in through the real email/code UI and receives a normal session cookie. No test-principal header is injected into that browser. An isolated test server uses in-memory PGlite, the mock email inbox, and the fictional Ada Testhouse household. Local fixture preparation gives that household an active invitation and an initial entrée A selection; a fixture admin opens the RSVP window during the demonstration. The fixture menu is not the wedding menu. No production guests, mail delivery, booking data or production database are involved.

The recording shows:

1. Anonymous query parameters cannot expose the Chicago map or planner.
2. Email/code sign-in returns the guest to the guide.
3. A museum pin opens its place card with a Google Maps directions link.
4. A 45-minute architecture plan displays its suggested stop and time-estimate explanation.
5. An agenda activity is added and remains after a reload.
6. Meal editing is closed, then available when the demo window opens; entrée A changes to entrée B through review and confirmation.
7. Sign-out hides the map and planner again, including with the planning query parameters present.

| Time | Demonstrated behavior |
|---|---|
| 0:00 | Public guide: query parameters cannot expose the guest map or planner |
| 0:08 | Real email-code sign-in using ada.testhouse@example.test |
| 0:29 | Authenticated guide: map and guest planning links appear |
| 0:34 | Map pin opens its place and real Google Maps directions handoff |
| 0:54 | 45-minute architecture plan, with honest visit-time estimates |
| 1:03 | Personal agenda: add an activity and verify it persists |
| 1:34 | Meal link reaches the actual release and editing-window gate |
| 1:40 | Demo window opened with fixture menu: guest changes and confirms a meal |
| 2:03 | Signed out: guest map and planner are hidden again |


## Before and after

Direct browser screenshots at 1440 × 1000, with reduced motion and the same routes and page sections. The proposal uses the site's supported list view. The additional phone map is 390 × 844. Images are not mockups or composites. [Capture metadata and image hashes](screenshots.json) identify the source commits and files.

### Welcome and sign-in discovery

| Before | After |
|---|---|
| ![Before: Welcome and sign-in discovery](before/home.jpg) | ![After: Welcome and sign-in discovery](after/home.jpg) |

### Proposal story

| Before | After |
|---|---|
| ![Before: Proposal story](before/story.jpg) | ![After: Proposal story](after/story.jpg) |

### Wedding welcome

| Before | After |
|---|---|
| ![Before: Wedding welcome](before/wedding.jpg) | ![After: Wedding welcome](after/wedding.jpg) |

### FAQ introduction

| Before | After |
|---|---|
| ![Before: FAQ introduction](before/faq.jpg) | ![After: FAQ introduction](after/faq.jpg) |

### Invitation rules for children and plus-ones

| Before | After |
|---|---|
| ![Before: Invitation rules for children and plus-ones](before/faq-invitation.jpg) | ![After: Invitation rules for children and plus-ones](after/faq-invitation.jpg) |

### Wedding guidance added before the existing dress-code section

| Before | After |
|---|---|
| ![Before: Wedding guidance added before the existing dress-code section](before/ceremony-guidance.jpg) | ![After: Wedding guidance added before the existing dress-code section](after/ceremony-guidance.jpg) |

### Travel and private room blocks

| Before | After |
|---|---|
| ![Before: Travel and private room blocks](before/travel.jpg) | ![After: Travel and private room blocks](after/travel.jpg) |

### Public planning sign-in gate

| Before | After |
|---|---|
| ![Before: Public planning sign-in gate](before/public-guide.jpg) | ![After: Public planning sign-in gate](after/public-guide.jpg) |

### Signed-in Chicago map and guest tools

| Before | After |
|---|---|
| ![Before: Signed-in Chicago map and guest tools](before/guest-tools.jpg) | ![After: Signed-in Chicago map and guest tools](after/guest-tools.jpg) |



[Complete welcome and sign-in link](after/welcome-signin.jpg) · [Guest map on a phone](after/guest-map-mobile.jpg)

## Saved results from the recording

| Map place | Generated plan |
|---|---|
| ![Museum card and directions link](after/record-map-place.jpg) | ![45-minute architecture plan](after/record-plan.jpg) |

| Agenda after reload | Meal change confirmed |
|---|---|
| ![Saved demo activity](after/record-agenda-saved.jpg) | ![Confirmed fixture meal selection](after/record-meal-saved.jpg) |

The site's generated stand-in portraits retain their existing disclosure. See the [demo rights and fixture notes](../README.md).
