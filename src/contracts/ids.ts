/**
 * Branded identifiers. Every domain entity uses an opaque, immutable ID.
 * IDs are ULID-like (time-sortable, URL-safe). Never expose sequential ints.
 */
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type SiteId = Brand<string, 'SiteId'>;
export type GuestId = Brand<string, 'GuestId'>;
export type HouseholdId = Brand<string, 'HouseholdId'>;
export type InvitationId = Brand<string, 'InvitationId'>;
export type AuthIdentityId = Brand<string, 'AuthIdentityId'>;
export type AdminId = Brand<string, 'AdminId'>;
export type EventId = Brand<string, 'EventId'>;
export type MealOptionId = Brand<string, 'MealOptionId'>;
export type TableId = Brand<string, 'TableId'>;
export type ExperienceId = Brand<string, 'ExperienceId'>; // AdventureMemory
export type RecommendationId = Brand<string, 'RecommendationId'>;
export type PlaceId = Brand<string, 'PlaceId'>;
export type ItineraryTemplateId = Brand<string, 'ItineraryTemplateId'>;
export type VenueSpaceId = Brand<string, 'VenueSpaceId'>;
export type KnowledgeRecordId = Brand<string, 'KnowledgeRecordId'>;
export type ContentSourceId = Brand<string, 'ContentSourceId'>;
export type MediaAssetId = Brand<string, 'MediaAssetId'>;
export type MediaUploadId = Brand<string, 'MediaUploadId'>;
export type MediaCollectionId = Brand<string, 'MediaCollectionId'>;
export type TransportationEntitlementId = Brand<string, 'TransportationEntitlementId'>;
export type TransportationClaimId = Brand<string, 'TransportationClaimId'>;
export type BookingReferenceId = Brand<string, 'BookingReferenceId'>;
export type ExternalActionId = Brand<string, 'ExternalActionId'>;
export type BiometricConsentId = Brand<string, 'BiometricConsentId'>;
export type AiSessionId = Brand<string, 'AiSessionId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type JobId = Brand<string, 'JobId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/** Time-sortable 26-char ULID. Uses Web Crypto (Node 22 + browsers). */
export function newId<T extends string = string>(now: number = Date.now()): T {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return (time + rand) as T;
}

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
