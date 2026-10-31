import { describe, expect, it } from 'vitest';
import { GUEST_CONTACT_EMAIL } from '@/domain/contact/copy';
import { shouldSkipForward } from '@/domain/inbound-mail/forward';

const config = {
  connectUserId: 'user_123',
  emailFrom: 'Sara + Tyler <hello@kendrick.wedding>',
  plannerForwardEmail: 'planner@example.test',
};

describe('shouldSkipForward', () => {
  it('requires the guest inbox recipient', () => {
    expect(
      shouldSkipForward({ from: 'guest@example.test', to: ['other@example.test'], subject: 'Hello' }, config),
    ).toBe('wrong_recipient');
  });

  it('blocks loops from the planner, site address, and prefixed subjects', () => {
    expect(shouldSkipForward({ from: 'guest@example.test', to: [GUEST_CONTACT_EMAIL], subject: 'Question' }, config)).toBeNull();
    expect(shouldSkipForward({ from: 'planner@example.test', to: [GUEST_CONTACT_EMAIL], subject: 'Re' }, config)).toBe('loop_sender');
    expect(
      shouldSkipForward({ from: 'guest@example.test', to: [GUEST_CONTACT_EMAIL], subject: '[kendrick.wedding] ping' }, config),
    ).toBe('loop_subject');
  });

  it('ignores auto-replies', () => {
    expect(
      shouldSkipForward({ from: 'guest@example.test', to: [GUEST_CONTACT_EMAIL], subject: 'Away' }, config, { 'Auto-Submitted': 'auto-replied' }),
    ).toBe('auto_reply');
  });
});
