import type { WireframeSpec } from '../types';

export const GATE: Record<string, WireframeSpec> = {
  'sign-in': {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Sign in' },
      { kind: 'form', label: 'Email code', submit: 'Send me a code', next: 'claim-verify', fields: [{ label: 'Email', type: 'email', required: true }] },
      { kind: 'callout', label: 'Have a passkey?', action: { label: 'Use a passkey', to: 'weekend', variant: 'secondary' } },
    ],
  },
  invitation: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'You are invited', lede: 'Household name', media: 'portrait' },
      { kind: 'facts', label: 'On this invitation', items: ['Guest', 'Guest', 'Events'] },
      { kind: 'callout', label: 'Claim it', action: { label: 'Claim your invitation', to: 'claim-verify', variant: 'primary' }, note: 'The link previews; it never signs anyone in by itself.' },
    ],
  },
  'claim-verify': {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Check your email', lede: 'We sent a six-digit code' },
      { kind: 'form', label: 'Code', submit: 'Continue', next: 'claim-welcome', fields: [{ label: 'Code', type: 'code', required: true, hint: 'Six digits' }] },
    ],
  },
  'claim-welcome': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Welcome', lede: 'You are in' },
      { kind: 'collection', label: 'What you can do now', item: 'Next step', count: 3, layout: 'list' },
      { kind: 'callout', label: 'Faster next time', action: { label: 'Add a passkey', to: 'claim-passkey', variant: 'secondary' } },
      { kind: 'callout', label: 'Continue', action: { label: 'Go to your weekend', to: 'weekend', variant: 'primary' } },
    ],
  },
  'claim-passkey': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Add a passkey', lede: 'Optional' },
      { kind: 'prose', label: 'What a passkey is, in one breath', paragraphs: 1 },
      { kind: 'callout', label: 'Save it', action: { label: 'Create a passkey', to: 'weekend', variant: 'primary' } },
    ],
  },
  'step-up': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Confirm it is you' },
      { kind: 'form', label: 'Code', submit: 'Confirm', fields: [{ label: 'Code', type: 'code', required: true }] },
    ],
  },
};
