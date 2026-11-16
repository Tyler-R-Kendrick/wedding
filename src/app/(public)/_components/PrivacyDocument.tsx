import Link from 'next/link';
import { ROUTES } from '@/domain/routes';
import type { Reader } from '@/domain/content/page-context';
import { observeConfig } from '@/lib/observe/config';
import { LegalDocument, LegalSection } from './LegalDocument';

export function PrivacyDocument({ reader }: { reader: Reader }) {
  // Session tracing is on only when a PostHog project is configured (src/lib/observe/config.ts), so
  // the page describes it only then: it never claims less than the site does, or more.
  const tracing = observeConfig() !== null;
  return (
    <LegalDocument
      title="Privacy"
      lede="This is a private wedding website for Sara and Tyler’s invited guests. This page explains, in plain language, what we collect and how we use it."
      currentPath="/privacy"
      reader={reader}
    >
      <LegalSection id="who" title="Who this site is for">
        <p>
          The site at kendrick.wedding is not a public social network. It is meant for people Sara and Tyler invited to their wedding and the couple who run it.
        </p>
      </LegalSection>
      <LegalSection id="collect" title="What we collect">
        <ul className="credits__list">
          <li className="credits__item">
            <p className="credits__name">Guest and household information</p>
            <p>Names, email addresses, optional phone numbers, RSVP answers, meal and dietary choices, plus-one details, and other weekend details you or the couple enter for your household.</p>
          </li>
          <li className="credits__item">
            <p className="credits__name">Sign-in</p>
            <p>
              Email addresses for one-time codes; phone numbers when you choose text sign-in (handled by Twilio Verify); and, if you use it, basic profile name and email from Google or Facebook so we can match you to your invitation by name. We do not receive your social passwords.
            </p>
          </li>
          <li className="credits__item">
            <p className="credits__name">Technical logs</p>
            <p>
              Standard hosting logs (for example request timing and errors) to keep the site running, including a note of any error your browser runs into on a page and the steps on that page that led to it. These say which page and which browser, never who you are. We do not use them for
              advertising.
            </p>
          </li>
          {tracing ? (
            <li className="credits__item">
              <p className="credits__name">How a visit went</p>
              <p>
                So we can find and fix problems, each visit is recorded as a replay of where you tapped and scrolled, with errors and loading times. The replay hides everything written on the page and everything you type, and leaves out every photo and video, so it shows the page’s layout and not its
                content. We also note a few actions, such as sending an RSVP or exporting a calendar, without what was in them. None of this carries your name or email: a signed-in visit is filed under an internal account number that means nothing outside this site. It uses no cookie. If your
                browser is set to “Do Not Track”, nothing is recorded.
              </p>
            </li>
          ) : null}
        </ul>
      </LegalSection>
      <LegalSection id="use" title="How we use it">
        <p>
          We use this information to run the wedding website: invitations, RSVP, travel tips for guests, photos, gifts, and messages between you and the couple. We do not sell your data or share it for marketing.
        </p>
      </LegalSection>
      <LegalSection id="processors" title="Services that help us run the site">
        <ul className="credits__list">
          <li className="credits__item">
            <p>
              <strong>Vercel</strong> hosts the site.
            </p>
          </li>
          <li className="credits__item">
            <p>
              <strong>Neon</strong> stores the database.
            </p>
          </li>
          <li className="credits__item">
            <p>
              <strong>Resend</strong> sends sign-in codes and other email from the site.
            </p>
          </li>
          <li className="credits__item">
            <p>
              <strong>Twilio Verify</strong> sends text sign-in codes when you choose that option.
            </p>
          </li>
          {tracing ? (
            <li className="credits__item">
              <p>
                <strong>PostHog</strong> stores the visit replays, action notes and error reports described above. It does not receive your name, email, cookies or location.
              </p>
            </li>
          ) : null}
          <li className="credits__item">
            <p>
              <strong>Google</strong> and <strong>Facebook</strong> only when you choose “Continue with Google” or Facebook sign-in; they provide basic profile fields for matching, not posts or friends lists.
            </p>
          </li>
        </ul>
        <p>These companies process data on our behalf under their own terms and privacy policies.</p>
      </LegalSection>
      <LegalSection id="choices" title="Your choices">
        <p>
          You can ask Sara and Tyler to update or delete information we hold about you. Use{' '}
          <Link href={ROUTES.guestAsk}>Ask Us</Link> once you are signed in, or contact them the way you already do for wedding questions.
        </p>
      </LegalSection>
      <LegalSection id="more" title="Terms">
        <p>
          See also our <Link href="/terms">Terms of use</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
