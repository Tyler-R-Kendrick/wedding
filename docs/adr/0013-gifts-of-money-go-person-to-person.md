# ADR-0013: Gifts of money go person to person

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-09-22 |
| Deciders | Tyler (integrator) |
| Related | ADR-0004 (amends its gifts row and its compliance grep), ADR-0007, ADR-0011, `docs/design/brief.md` §2 |

## Context

Tyler asked for a registry that can take gifts of money, with three hard constraints:

1. **Guests are not charged extra fees.**
2. **The couple are not a merchant.** No card processing, no charge collection.
3. **Nobody holds the money in escrow.**

He also asked for the categories every registry ships with (honeymoon, home, adoption, and so on)
and for trusted prior work over anything built here.

ADR-0004 already settles (2): the site is never merchant of record, and every transaction is a
hand-off to a provider. What it left open was *which* provider, and the three obvious candidates
fail (1) or (3) by default. The fees below were read from each provider's own pages on 2026-09-22.

| Option | Guest fee | Who holds the money | Verdict |
|---|---|---|---|
| Stripe (or any processor) on this site | ~3% unless the couple absorb it | Stripe, then the couple | Rejected by ADR-0004: merchant of record |
| Zola cash funds, card checkout | 2.5% "handling fee" unless the couple absorb it, and then it comes out of the transfer | Zola, until the couple transfer it | Fails (1) or (3) |
| Joy cash funds, card checkout | Card fee paid by the guest (to Stripe) | Joy Wallet, until the couple transfer it | Fails (1) and (3) |
| Joy / Zola "zero-fee" funds | None from a bank, balance or debit card | **Nobody** — it goes to the couple's own Venmo, PayPal or Cash App | Meets all three |

The last row is the important finding. Both leading registries already solved this problem, and
their solution is the same: the fund is a label, and the money moves over a peer-to-peer network
straight into the couple's own account. Joy says so in as many words: for app payments "Joy can
only record that a guest reported completing a payment." The registry adds a page and a
self-reported tally on top of Venmo; it adds nothing to the money's path.

## Decision

1. **Money moves only over networks guests already use, into the couple's own accounts:**
   Zelle, Venmo, PayPal (PayPal.Me), Cash App, and a check by mail. The site never sees, holds,
   routes, confirms or totals a payment. It does not know whether one was made.
2. **The site builds each network's documented link from a handle** — it never takes a URL:
   - Venmo `https://venmo.com/<username>?txn=pay&note=<fund>` — probed 2026-09-22: redirects to
     `account.venmo.com`, which on a phone opens the app's pay screen with the note filled in.
     The note carries the fund, so the couple can tell a honeymoon gift from a house gift.
   - PayPal `https://www.paypal.com/paypalme/<name>` — what `paypal.me/<name>` redirects to.
   - Cash App `https://cash.app/$<cashtag>` — Cash App's documented payment URL for a $Cashtag.
   - Zelle and checks have no link: the page shows the enrolled email or phone, or the mailing
     address, and the guest sends from their own bank or by post.

   Each host is pinned in the redirect allowlist to that one shape (`venmo.com` with a single
   username-shaped path segment, `www.paypal.com/paypalme/`, `cash.app/$`), so neither a configured
   gift link nor a tampered row can reach a sign-in page, a settings page or a checkout on the same
   host. Handles are validated on write
   **and** re-validated on read, the same rule the allowlist already applies to URLs.
3. **No amounts, ever.** No `amount` parameter, no goals, no progress bars (ADR-0004 §6). The site
   could not total contributions honestly anyway: it never learns of them.
4. **Every way to give says what its network charges the sender**, in the network's own terms, with
   its source and the date it was read (ADR-0011). "No fee" is true from a bank account or app
   balance on all five; Venmo and Cash App add 3% on a credit card and PayPal adds 2.9% plus a
   fixed fee on any card. The site does not claim what it cannot guarantee.
5. **Zelle and mailing details are personal.** They are shown only to a guest whose invitation is
   live (a `guest` principal holding `view_event`, so a revoked or expired invitation takes them
   away even while its session lasts) and to admins. A check needs the payee the couple enter; the
   site never supplies a name of its own. An anonymous visitor, a crawler, and the
   AI concierge answering one receive the rail and its fee, never the email, phone or address. The
   Venmo, PayPal and Cash App handles are public profile links by design and are shown to everyone.
   `/gifts` is now a personalized route (`Cache-Control: private, no-store`).
6. **Funds are content, not money.** `honeymoon`, `home`, `adoption` and `next-adventures` are
   defaults in code (`src/domain/gifts/funds.ts`) so they exist with no seed; a `gift_funds` row with
   the same id replaces a default's words, order or visibility, and a new id adds one (up to 12 in
   all, which keeps `list_gift_links` inside what the concierge may be handed). A save changes only
   the fields it carries. With no way
   to give configured, no funds are shown: a list of reasons to give with no way to give is a dead end.
7. **A registry of things stays delegated** exactly as ADR-0004 had it (`gift_links`, Zola / The
   Knot / Joy). A couple who would rather keep their funds on Joy can still link a Joy page as an
   `adventure-fund` gift link; the two sit side by side on the page.
8. **Clicks are logged as hand-offs, not payments.** `open_gift_fund` writes one
   `external_action_records` row of kind `gift_fund` with the host only, like `open_gift_link`.

## Consequences

**Positive.** All three constraints hold by construction rather than by configuration: there is no
code path in which money reaches the site or anyone in between. No PCI scope, no refunds, no 1099
questions from a processor, no Stripe account, no dependency on a registry's fee policy. Guests
use an app they already trust, often already signed in, on the phone they are holding.

**Negative / costs.**
- No automatic thank-you list: the couple read gifts in their own Venmo, PayPal, Cash App and bank
  statements. The fund in the Venmo note is the only attribution. (Joy's self-reported tally is the
  same information, entered by the guest.)
- A guest paying by credit card pays their network's fee. The page says so beside each network;
  the site cannot waive a fee it is not party to.
- Venmo payments are visible to the sender's friends unless they choose Private; the page says so.
- Deep-link formats can change. The Venmo pay link is widely used but not formally documented; if it
  breaks it degrades to the profile page, from which a guest can still pay.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Send guests to Joy or Zola for all money gifts | Two hops (our page → registry → Venmo) for the same outcome, and both registries default a card checkout that charges the guest or holds the money. Kept available as a gift link. |
| Stripe Payment Links / Checkout | Merchant of record (ADR-0004), and a fee on every card gift. |
| Suggested amounts or fund goals | ADR-0004 §6; and unverifiable, since the site never learns what was sent. |
| Show Zelle details to everyone | An email or phone number on a public page is a spam and impersonation target. |

## Compliance

- `grep -rnEi "stripe|card_number|cvv" src` is empty. `paypal` now appears in `src`, only as a
  hand-off rail (`src/domain/gifts/rails.ts`, the allowlist, display names) — ADR-0004's grep is
  amended accordingly.
- `tests/unit/gift-rails.test.ts`: handles normalised and refused; every built link is on the
  allowlist and carries no amount; payment hosts reject every other path.
- `tests/integration/gifts-reservations.test.ts` › *gifts of money*: no funds without a rail;
  anonymous, `ai` and `webmcp` responses never contain a Zelle email or address; a tampered rail row
  is dropped; `open_gift_fund` records the host only.
- `tests/security/voucher.spec.ts`: no card fields and no processor checkout script on `/gifts`.
