import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, LegalSection } from '../_components/LegalDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Terms of use' };

export default async function TermsPage() {
  return (
    <LegalDocument
      title="Terms of use"
      lede="By using this private wedding website you agree to these simple rules. They exist to keep the site useful for Sara, Tyler, and their guests."
      currentPath="/terms"
    >
      <LegalSection id="purpose" title="What this site is">
        <p>
          kendrick.wedding is a private site for Sara and Tyler’s wedding. Content here is for invited guests and the couple, not for resale or scraping.
        </p>
      </LegalSection>
      <LegalSection id="account" title="Your account">
        <p>
          Sign-in is by invitation. Use your own email or phone, or the social sign-in option, only to access your household’s information. Do not try to sign in as someone else.
        </p>
      </LegalSection>
      <LegalSection id="content" title="Photos and messages">
        <p>
          Photos, stories, and uploads may include people who expect privacy at a wedding. Do not repost others’ images or details without their permission. Professional and guest media on the site may carry separate rights — see{' '}
          <Link href="/credits">Photo credits</Link>.
        </p>
      </LegalSection>
      <LegalSection id="availability" title="Availability">
        <p>
          We try to keep the site running smoothly but do not guarantee uninterrupted access. Features may change as the weekend approaches.
        </p>
      </LegalSection>
      <LegalSection id="privacy" title="Privacy">
        <p>
          Our <Link href="/privacy">Privacy</Link> page describes what we collect and how to ask for changes or deletion.
        </p>
      </LegalSection>
      <LegalSection id="contact" title="Questions">
        <p>Questions about these terms? Ask Sara and Tyler through the site or your usual way of reaching them.</p>
      </LegalSection>
    </LegalDocument>
  );
}
