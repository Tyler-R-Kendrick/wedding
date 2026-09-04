# Research: wedding-site standards and inspiration (Sept 2026)

The actionable version of this research is the
[`wedding-site-standards`](../../.claude/skills/wedding-site-standards/SKILL.md)
skill, which agents load automatically. This note keeps the sources and
the reasoning.

## Industry baseline (The Knot, Zola, Joy, Minted)
- Expected pages: Home (names, date, place, RSVP), Our Story, Schedule/
  Events, Travel & Accommodations, RSVP (with meal choice, deadline
  typically 2–4 weeks out), Registry, FAQ, Wedding Party, Photos.
- Guests treat password protection and photo galleries as standard.
- Joy and Zola lead on RSVP/guest-list depth; Minted's RSVP is weaker;
  Bliss & Bone is the design-led builder; Riley & Grey is praised for RSVP UX.
- Sources: <https://www.theknot.com/content/what-to-put-on-your-wedding-website>,
  <https://www.theknot.com/content/wedding-website-faq-page>,
  <https://withjoy.com/blog/what-to-put-on-your-wedding-website/>,
  <https://www.zola.com/wedding-planning/website>,
  <https://caratsandcake.com/articles/best-wedding-websites>,
  <https://paperlust.co/blog/wedding-website-builders-compared/>

## Award-level references (Awwwards)
- Awwwards jury weights: Design 40%, Usability 30%, Creativity 20%, Content 10%.
- Wedding nominees to study: "The Wedding of Lucy and Si", "OurNine9 —
  Eric & Nikki", "Arpeeta & Arpan".
- Sources: <https://www.awwwards.com/websites/sites_of_the_day/>,
  <https://www.awwwards.com/sites/the-wedding-of-lucy-and-si>,
  <https://www.awwwards.com/sites/ournine9-eric-nikkis-wedding-website>,
  <https://www.awwwards.com/sites/arpeeta-arpan-wedding-website>

## 2026 design direction signals
- Minimalist layouts with expressive typography, generous whitespace,
  photography-led pacing, gentle palettes, soft motion; parallax only in
  moderation. Sources: <https://99designs.com/inspiration/websites/wedding>,
  <https://www.sitebuilderreport.com/inspiration/wedding-websites-examples>

## Decisions taken into DESIGN.md / PRODUCT.md
- Editorial, paper-and-ink direction with one accent (terracotta); Caslon
  display + Newsreader text. Chosen to be *distinct* from both the
  wedding-template look (script + blush + florals) and the AI look
  (Inter + purple gradient), and to pass impeccable's overused-font rule.
- Mobile-first with a sticky RSVP/Directions bar; WCAG 2.2 AA; printable
  logistics pages; password gate + `noindex`.
