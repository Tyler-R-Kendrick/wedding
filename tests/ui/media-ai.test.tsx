import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MyBiometricConsent } from '@/capabilities/biometrics';
import { CONSENT_POLICY_VERSION, CONSENT_TEXT, CONSENT_TEXT_HASH, currentConsentPolicy } from '@/domain/biometrics/policy';
import { FaceMatching } from '@/components/mediaai/FaceMatching';
import { MediaSearch, describeSource } from '@/components/mediaai/MediaSearch';

// The ui project runs without globals, so testing-library's auto-cleanup is not installed.
afterEach(cleanup);

const base: MyBiometricConsent = {
  available: false,
  unavailableReason: 'flag_off',
  policy: null,
  consent: { status: 'none', record: null, revokedAt: null, supersededBy: null },
  enrolment: null,
  matches: [],
  deletions: [],
  hasData: false,
};

describe('the face-matching panel with the feature off', () => {
  it('says the feature is off and shows no consent copy at all', () => {
    render(<FaceMatching initial={base} candidates={[]} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('Finding photos of yourself');
    expect(document.body.textContent).toMatch(/switched off/i);
    // ADR-0006 §1: no UI hints at the feature while it is off.
    expect(document.body.textContent).not.toContain('biometric identifier');
    expect(document.body.textContent).not.toContain(CONSENT_POLICY_VERSION);
    expect(screen.queryByRole('button', { name: /agree/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /check my photos/i })).toBeNull();
  });

  it('offers deletion anyway when the guest already has data', () => {
    render(<FaceMatching initial={{ ...base, hasData: true }} candidates={[]} />);
    expect(screen.getByRole('button', { name: /delete my facial data/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });

  it('distinguishes the two closed gates in what it tells the guest', () => {
    render(<FaceMatching initial={{ ...base, unavailableReason: 'readiness_off' }} candidates={[]} />);
    expect(document.body.textContent).toMatch(/legal review/i);
  });
});

describe('the face-matching panel with the feature available', () => {
  const available: MyBiometricConsent = { ...base, available: true, unavailableReason: null, policy: currentConsentPolicy() };

  it('shows purpose, term, retention, provider and the exact recorded wording before anything is collected', () => {
    render(<FaceMatching initial={available} candidates={[]} />);
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['What it does', 'For how long', 'Deletion', 'Who processes it']);
    expect(document.body.textContent).toContain(CONSENT_POLICY_VERSION);
    expect(document.querySelector('.mi-policy__text')?.textContent).toBe(CONSENT_TEXT);
    expect(CONSENT_TEXT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the agree button disabled until the guest attests to being an adult', () => {
    render(<FaceMatching initial={available} candidates={[]} />);
    const agree = screen.getByRole('button', { name: /I have read this and I agree/i }) as HTMLButtonElement;
    expect(agree.disabled).toBe(true);
    const attestation = screen.getByRole('checkbox') as HTMLInputElement;
    expect(attestation.checked).toBe(false);
    expect(document.body.textContent).toMatch(/18 or older/);
  });

  it('asks for reference photos only once consent is recorded, and never shows the picker before that', () => {
    const consented: MyBiometricConsent = {
      ...available,
      consent: { status: 'active', record: { id: 'C1', policyVersion: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH, scope: 'self_match', grantedAt: '2027-08-01T12:00:00Z', revokedAt: null }, revokedAt: null, supersededBy: null },
    };
    const { unmount } = render(<FaceMatching initial={available} candidates={[]} />);
    expect(document.querySelector('.mi-picker')).toBeNull();
    unmount();
    render(<FaceMatching initial={consented} candidates={[]} />);
    expect(document.body.textContent).toMatch(/Add a photo of yourself from the upload page first/);
    expect(screen.getByRole('button', { name: /withdraw consent/i })).toBeTruthy();
  });
});

describe('search results state their provenance', () => {
  it('never calls a human caption a machine suggestion', () => {
    expect(describeSource({ sourceMetadata: { captionSource: 'ai', captionModel: 'm', humanCaption: true, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/person who added it/);
    expect(describeSource({ sourceMetadata: { captionSource: 'ai', captionModel: 'claude-vision', humanCaption: false, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/claude-vision, not yet reviewed/);
    expect(describeSource({ sourceMetadata: { captionSource: 'none', captionModel: null, humanCaption: false, indexedAt: null, scheduleSlot: 'unknown', venueClass: 'unknown', tags: [] } })).toMatch(/not from a description/);
  });

  it('labels every search control and offers the example queries', () => {
    render(<MediaSearch collections={[{ slug: 'guest-uploads', title: 'From our guests', description: null, kind: 'guest_uploads', chapter: null, visibility: 'guests', acceptsUploads: true, itemCount: 3 }]} />);
    expect(screen.getByLabelText(/What are you looking for/)).toBeTruthy();
    expect(screen.getByLabelText('Album')).toBeTruthy();
    expect(screen.getByLabelText('Photos or video')).toBeTruthy();
    expect(screen.getByLabelText('When')).toBeTruthy();
    for (const example of ['first dance', 'toasts', 'flowers on the table', 'outside at dusk']) {
      expect(screen.getByRole('button', { name: example })).toBeTruthy();
    }
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
