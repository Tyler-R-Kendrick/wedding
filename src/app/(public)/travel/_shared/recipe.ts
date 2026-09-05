import type { ReactNode } from 'react';

/**
 * Page-recipe seam. Pages fetch theme-agnostic data through capabilities and render a recipe;
 * the theme kit (Swarm B) supplies `theme.recipes[page]` with the same props at integration.
 * Recipes are plain server-renderable components: tokens only, no raw hex or font literals.
 */
export type PageRecipe<TData, TSlots = Record<string, never>> = (props: { data: TData; slots: TSlots }) => ReactNode;

/** Short notice codes carried in the query string after a redirecting form action. */
export const NOTICES = {
  confirmed: 'Thanks. We marked that as confirmed.',
  cancelled: 'That item is now cancelled.',
  reopened: 'That item is back to planned.',
  removed: 'Removed from your trip.',
  profile_deleted: 'Your travel preferences were deleted.',
  saved: 'Saved.',
  not_found: 'We could not find that item.',
  forbidden: 'You do not have access to that.',
  invalid: 'Please check the highlighted fields and try again.',
  error: 'Something went wrong on our side. Please try again in a moment.',
} as const;
export type NoticeCode = keyof typeof NOTICES;

export const noticeFor = (code: string | undefined): string | null => (code && code in NOTICES ? NOTICES[code as NoticeCode] : null);
