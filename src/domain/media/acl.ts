import type { Principal } from '@/contracts/principal';
import { hasEntitlement } from '@/contracts/principal';
import type { MediaVisibility } from '@/db/schema/media';

/**
 * Visibility rules (ADR-0005 §5). Pure functions used by every read capability; hidden UI is
 * never authorization. `view_private_media` unlocks guest-visible collections; `admin_media`
 * unlocks everything; owners always see their own uploads in "My uploads" (never in the gallery
 * before publication).
 */
export interface VisibleCollection {
  visibility: MediaVisibility;
}

export interface VisibleAsset {
  status: string;
  ownerGuestId: string | null;
  ownerHouseholdId: string | null;
  visibility: MediaVisibility | null;
}

export function isMediaAdmin(principal: Principal): boolean {
  return principal.kind === 'system' || (principal.kind === 'admin' && hasEntitlement(principal, 'admin_media'));
}

export function canViewVisibility(principal: Principal, visibility: MediaVisibility, owner?: { ownerGuestId: string | null; ownerHouseholdId: string | null }): boolean {
  if (isMediaAdmin(principal)) return true;
  switch (visibility) {
    case 'public':
      return true;
    case 'guests':
      return principal.kind === 'guest' && hasEntitlement(principal, 'view_private_media');
    case 'household':
      return principal.kind === 'guest' && hasEntitlement(principal, 'view_private_media') && !!owner?.ownerHouseholdId && owner.ownerHouseholdId === principal.householdId;
    case 'private':
      return principal.kind === 'guest' && !!owner?.ownerGuestId && owner.ownerGuestId === principal.guestId;
  }
}

export function canViewCollection(principal: Principal, collection: VisibleCollection): boolean {
  return canViewVisibility(principal, collection.visibility);
}

export function effectiveVisibility(asset: { visibility: MediaVisibility | null }, collection: VisibleCollection): MediaVisibility {
  return asset.visibility ?? collection.visibility;
}

/** Gallery visibility: published AND the effective visibility admits the principal. */
export function canViewPublishedAsset(principal: Principal, asset: VisibleAsset, collection: VisibleCollection): boolean {
  if (isMediaAdmin(principal)) return true;
  if (asset.status !== 'published') return false;
  return canViewVisibility(principal, effectiveVisibility(asset, collection), asset);
}

export function isOwner(principal: Principal, asset: { ownerGuestId: string | null }): boolean {
  return principal.kind === 'guest' && !!asset.ownerGuestId && asset.ownerGuestId === principal.guestId;
}

/** Detail view: the owner may see their own item in any state; everyone else only when published + visible. */
export function canViewAssetDetail(principal: Principal, asset: VisibleAsset, collection: VisibleCollection): boolean {
  return isOwner(principal, asset) || canViewPublishedAsset(principal, asset, collection);
}

export function canDeleteAsset(principal: Principal, asset: { ownerGuestId: string | null; source: string }): boolean {
  if (isMediaAdmin(principal)) return true;
  return asset.source === 'guest' && isOwner(principal, asset);
}
