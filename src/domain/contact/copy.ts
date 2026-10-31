/** Guest-facing contact address for questions, lost invitation links, and the inbound forward target. */
export const GUEST_CONTACT_EMAIL = 'hello@kendrick.wedding';

/** Tyler receives a BCC on every guest message forwarded to the planner. */
export const INBOUND_FORWARD_BCC = 'contact.tylerkendrick@gmail.com';

export const FORWARDED_SUBJECT_PREFIX = '[kendrick.wedding]';

export function guestContactMailtoHref(): string {
  return `mailto:${GUEST_CONTACT_EMAIL}`;
}

export function guestContactFaqAnswer(): string {
  return `Email us at ${GUEST_CONTACT_EMAIL}. We read every message and share questions with our wedding planner, Michelle Elaine Sunder of Bustle & Lace.`;
}

export function guestContactLostLinkLine(): string {
  return `Email ${GUEST_CONTACT_EMAIL} and we will help you find your invitation.`;
}
