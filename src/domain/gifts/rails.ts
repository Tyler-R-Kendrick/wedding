import { z } from 'zod';
import type { GiftRail } from '@/db/schema';

/**
 * The payment networks a gift of money can travel over (ADR-0013), and everything the site knows
 * about each one. Nothing here moves money: a rail is the couple's own account on a network guests
 * already trust, and the site's whole job is to build that network's documented link, or to show
 * the details a guest types into their own bank.
 *
 * Fee lines are operational facts (ADR-0011), so each carries the page it was read from and the date
 * it was read. They describe what the NETWORK charges the sender; the site charges nothing and
 * cannot add a fee, because it is not in the path of the money at all.
 */
export interface RailSpec {
  rail: GiftRail;
  displayName: string;
  /** `link`: the site builds a hand-off URL. `direct`: the guest sends from their own bank or by post. */
  mode: 'link' | 'direct';
  /**
   * Personal details (an email, a phone number, a street address). Shown only to a guest who has
   * opened the site from their invitation, and to admins — never to an anonymous visitor, a crawler,
   * or the AI concierge answering one.
   */
  personal: boolean;
  /** Validates and normalises what the couple type in the admin form. */
  handle: z.ZodType<string>;
  /** Builds the provider's own link from a normalised handle. `note` is the fund, for rails that take one. */
  url?: (handle: string, note: string) => string;
  /** What it costs the guest, in the network's own terms. Never an amount. */
  fee: string;
  /** How to send, for `direct` rails; `{handle}` and `{name}` are filled in. */
  instructions?: string;
  source: { url: string; verifiedAt: string };
}

const VERIFIED = '2026-09-22';

const US_PHONE = /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

export const RAILS: Readonly<Record<GiftRail, RailSpec>> = {
  zelle: {
    rail: 'zelle',
    displayName: 'Zelle',
    mode: 'direct',
    personal: true,
    // Zelle has no payment link: a guest sends from their own bank's app to an enrolled email or US
    // mobile number. Normalise a phone to one format so the page and the bank agree on what it is.
    handle: z
      .string()
      .trim()
      .transform((s) => {
        const phone = US_PHONE.exec(s);
        return phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : s.toLowerCase();
      })
      .pipe(z.union([z.email(), z.string().regex(/^\(\d{3}\) \d{3}-\d{4}$/)])),
    fee: 'Zelle itself charges no fee and moves money straight from your bank to ours. A few banks add their own, so check with yours if you are unsure.',
    instructions: 'Open your own bank’s app or website, choose Zelle, and send to {handle}.',
    source: { url: 'https://www.zelle.com/faq', verifiedAt: VERIFIED },
  },
  venmo: {
    rail: 'venmo',
    displayName: 'Venmo',
    mode: 'link',
    personal: false,
    // Venmo usernames: 5–30 letters, digits, hyphens or underscores. People share them with the @.
    handle: z
      .string()
      .trim()
      .transform((s) => s.replace(/^@/, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9_-]{5,30}$/, 'A Venmo username is 5–30 letters, numbers, hyphens or underscores.')),
    // Probed 2026-09-22: venmo.com/<user>?txn=pay redirects to account.venmo.com, which on a phone
    // opens the app's pay screen with the note filled in (venmo://paycharge?…&txn=pay&note=…).
    // No `amount`: the site never suggests one (ADR-0004 §6).
    url: (handle, note) => `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&note=${encodeURIComponent(note)}`,
    fee: 'Free from your Venmo balance, bank account or debit card. Venmo adds 3% if you pay with a credit card.',
    source: { url: 'https://venmo.com/resources/our-fees/', verifiedAt: VERIFIED },
  },
  paypal: {
    rail: 'paypal',
    displayName: 'PayPal',
    mode: 'link',
    personal: false,
    handle: z
      .string()
      .trim()
      .transform((s) => s.replace(/^(?:https?:\/\/)?(?:www\.)?(?:paypal\.me\/|paypal\.com\/paypalme\/)/i, '').replace(/\/+$/, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9]{1,20}$/, 'A PayPal.Me name is up to 20 letters and numbers.')),
    // paypal.me/<name> 301s here; linking the destination skips a hop and keeps the allowlist to one host.
    url: (handle) => `https://www.paypal.com/paypalme/${encodeURIComponent(handle)}`,
    fee: 'Free from your PayPal balance or bank account when you choose “Friends and Family”. PayPal adds a fee if you pay with a card.',
    source: { url: 'https://www.paypal.com/us/digital-wallet/paypal-consumer-fees', verifiedAt: VERIFIED },
  },
  cashapp: {
    rail: 'cashapp',
    displayName: 'Cash App',
    mode: 'link',
    personal: false,
    handle: z
      .string()
      .trim()
      .transform((s) => s.replace(/^(?:https?:\/\/)?cash\.app\//i, '').replace(/^\$/, ''))
      .pipe(z.string().regex(/^(?=.*[A-Za-z])[A-Za-z0-9_-]{1,20}$/, 'A $Cashtag is up to 20 characters and includes at least one letter.')),
    // Cash App documents cash.app/$cashtag as the payment URL every $Cashtag gets.
    url: (handle) => `https://cash.app/$${encodeURIComponent(handle)}`,
    fee: 'Free from your Cash App balance or debit card. Cash App adds 3% if you pay with a credit card.',
    source: { url: 'https://cash.app/help/3123-what-is-a-cashtag', verifiedAt: VERIFIED },
  },
  check: {
    rail: 'check',
    displayName: 'Check by mail',
    mode: 'direct',
    personal: true,
    handle: z
      .string()
      .trim()
      .transform((s) =>
        s
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join('\n'),
      )
      .pipe(z.string().min(10, 'Enter the full mailing address, one line per row.').max(300)),
    fee: 'No fee.',
    instructions: 'Make it out to {name} and mail it to:\n{handle}',
    source: { url: '/gifts', verifiedAt: VERIFIED },
  },
};

export const RAIL_ORDER: readonly GiftRail[] = ['zelle', 'venmo', 'paypal', 'cashapp', 'check'];

export function parseRailHandle(rail: GiftRail, raw: string): { ok: true; handle: string } | { ok: false; message: string } {
  const r = RAILS[rail].handle.safeParse(raw);
  if (r.success) return { ok: true, handle: r.data };
  return { ok: false, message: r.error.issues[0]?.message ?? `That is not a valid ${RAILS[rail].displayName} detail.` };
}

/** Fills a `direct` rail's instructions. A check with no payee falls back to the couple's names. */
export function railInstructions(spec: RailSpec, handle: string, recipientName: string | null): string | null {
  if (!spec.instructions) return null;
  return spec.instructions.replace('{handle}', handle).replace('{name}', recipientName ?? 'Sara or Tyler');
}
