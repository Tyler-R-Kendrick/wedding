import type { Metadata } from 'next';
import Link from 'next/link';
import { ROUTES } from '@/domain/routes';
import { LegalDocument, LegalSection } from '../_components/LegalDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Privacy' };

export default async function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy"
      lede="This is a private wedding website for Sara and Tyler’s invited guests. This page explains, in plain language, what we collect and how we use it."
      currentPath="/privacy"
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
              Email addresses for one-time codes; phone numbers when you choose text sign-in (handled by Twilio Verify); and, if you use it, basic profile name and email from Google or Facebook so we can match you to the guest list by name. We do not receive your social passwords.
            </p>
          </li>
          <li className="credits__item">
            <p className="credits__name">Technical logs</p>
            <p>Standard hosting logs (for example request timing and errors) to keep the site running. We do not use them for advertising.</p>
          </li>
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
