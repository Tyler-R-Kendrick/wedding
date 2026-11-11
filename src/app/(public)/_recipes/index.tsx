import { headers } from 'next/headers';
import type { ComponentType, ReactNode } from 'react';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import type { OurVenuePageData } from '@/capabilities/get_venue_facts';
import type { StoryPageData } from '@/capabilities/get_story';
import type { GiftsProps, PhotoAlbumProps, PhotosProps, TravelProps } from '@/themes/content-types';
import type { VenueRoomData } from '@/capabilities/show_venue_room';
import type { RecommendationCard } from '@/domain/content/views';
import { GUEST_PORTAL, isGuestPortalRoute, isPlaceDetailPath } from '@/domain/lifecycle/guest-portal';
import { ROUTES } from '@/domain/routes';
import type { Reader } from '@/domain/content/page-context';
import { ANONYMOUS, getPrincipal } from '@/lib/principal';
import { getTheme } from '@/themes';
import { DEFAULT_THEME } from '@/themes/registry';
import { selectContentRecipe, type ContentRecipeKey, type ContentRecipes } from '@/themes/content';
import { PATHNAME_HEADER, PREVIEW_HEADER } from '@/themes/routes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';
import type { PageFrame, ThemeId } from '@/themes/types';
import { AdventureDetailPage } from './AdventureDetailPage';
import { AdventuresPage, type AdventuresRecipeProps } from './AdventuresPage';
import { AskPage, type AskRecipeProps } from './AskPage';
import { OurVenuePage } from './OurVenuePage';
import { RecommendationPage } from './RecommendationPage';
import { StoryPage } from './StoryPage';
import { VenueSpacePage } from './VenueSpacePage';
import { TravelPage } from './TravelPage';
import { GiftsPage } from './GiftsPage';
import { PhotoAlbumPage } from './PhotoAlbumPage';
import { PhotosPage } from './PhotosPage';

/**
 * The recipe seam. Pages fetch theme-agnostic data through capabilities and render
 * `recipes.<Page>`; Swarm B's integrator points this object at the theme kit's recipes
 * (`src/themes/<id>/recipes`) and nothing above this line needs to change.
 */
export interface PageRecipes {
  StoryPage: ComponentType<{ data: StoryPageData }>;
  AdventuresPage: ComponentType<AdventuresRecipeProps>;
  AdventureDetailPage: ComponentType<{ data: AdventureDetailData }>;
  RecommendationPage: ComponentType<{ card: RecommendationCard }>;
  OurVenuePage: ComponentType<{ data: OurVenuePageData }>;
  VenueSpacePage: ComponentType<{ data: VenueSpaceData }>;
  AskPage: ComponentType<AskRecipeProps>;
  /** Level 08. The fallback is swarm F's single recipe; both themes now supply their own. */
  TravelPage: ComponentType<Omit<TravelProps, 'frame'>>;
  /** Level 09. Fallback is swarm G's plain recipe; both themes supply their own. */
  GiftsPage: ComponentType<Omit<GiftsProps, 'frame'>>;
  /** Level 10. Fallback is swarm H's plain media shell; both themes supply their own. */
  PhotosPage: ComponentType<Omit<PhotosProps, 'frame'>>;
  PhotoAlbumPage: ComponentType<Omit<PhotoAlbumProps, 'frame'>>;
}
type VenueSpaceData = VenueRoomData;

export const placeholderRecipes: PageRecipes = {
  StoryPage,
  AdventuresPage,
  AdventureDetailPage,
  RecommendationPage,
  OurVenuePage,
  VenueSpacePage,
  AskPage,
  TravelPage,
  GiftsPage,
  PhotosPage,
  PhotoAlbumPage,
};

type PropsOf<K extends ContentRecipeKey> = Omit<Parameters<ContentRecipes[K]>[0], 'frame'>;

/** The frame for whoever sent this request: their lifecycle (an admin's preview included), their navigation. */
async function requestFrame(theme: ThemeId, currentPath: string, within: boolean | undefined): Promise<PageFrame> {
  const h = await headers();
  const preview = h.get(PREVIEW_HEADER);
  const requestPath = h.get(PATHNAME_HEADER) ?? currentPath;
  const onPortal = isGuestPortalRoute(requestPath);
  // Guest layout does not wrap these routes (the recipe already has a Shell). Use the portal
  // URL so that Shell's nav is the guest portal, with the section path on a detail page so the
  // parent item stays current: a recommendation's page belongs to Your Trip.
  const pathForFrame =
    onPortal && within && isPlaceDetailPath(requestPath)
      ? GUEST_PORTAL.travel
      : onPortal
        ? requestPath
        : currentPath;
  // Resolve the principal on every themed page so signed-in guests see portal links and the
  // account menu at first paint.
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  return buildPageFrame({ theme, currentPath: pathForFrame, lifecycle: { principal, ...(preview ? { preview: { value: preview, source: 'query' as const } } : {}) } });
}

/**
 * Themed dispatch (level 05). Each page component builds the page frame (facts, lifecycle, nav for
 * the current path) and renders the design's recipe; a design without a recipe for the page falls
 * back to Swarm C's placeholder recipe. For the `request` reader the frame is that reader's own,
 * resolved from the request; for `anonymous` it is nobody's and reads no request, which is what
 * lets the page be prerendered (`src/themes/routes.ts`).
 */
function themed<K extends ContentRecipeKey>(key: K, currentPath: string, fallback: ComponentType<PropsOf<K>>, opts: { signedIn?: boolean; within?: boolean } = {}, reader: Reader = 'request'): ComponentType<PropsOf<K>> {
  const Themed = async (props: PropsOf<K>): Promise<ReactNode> => {
    const theme = reader === 'anonymous' ? DEFAULT_THEME : await getRequestTheme();
    const recipe = selectContentRecipe(getTheme(theme), key);
    if (!recipe) {
      const Fallback = fallback;
      return <Fallback {...props} />;
    }
    const built = reader === 'anonymous' ? await buildPageFrame({ theme, currentPath, lifecycle: { principal: ANONYMOUS } }) : await requestFrame(theme, currentPath, opts.within);
    // A detail page (`within`) lights its section's item as the place the reader is, not the page.
    const frame = opts.within ? { ...built, nav: { ...built.nav, currentIsAncestor: true } } : built;
    const render = recipe as unknown as (p: PropsOf<K> & { frame: PageFrame }) => ReactNode;
    return render({ ...props, frame });
  };
  Themed.displayName = `Themed(${key})`;
  return Themed;
}

export const themedRecipes: PageRecipes = {
  StoryPage: themed('story', ROUTES.story, StoryPage),
  AdventuresPage: themed('adventures', ROUTES.adventures, AdventuresPage),
  AdventureDetailPage: themed('adventureDetail', ROUTES.adventures, AdventureDetailPage, { within: true }),
  RecommendationPage: themed('recommendation', ROUTES.guestTravel, RecommendationPage, { signedIn: true, within: true }),
  OurVenuePage: themed('ourVenue', ROUTES.ourVenue, OurVenuePage),
  VenueSpacePage: themed('venueSpace', ROUTES.ourVenue, VenueSpacePage, { within: true }),
  AskPage: themed('ask', ROUTES.guestAsk, AskPage),
  TravelPage: themed('travel', ROUTES.guestTravel, TravelPage, { signedIn: true }),
  GiftsPage: themed('gifts', ROUTES.gifts, GiftsPage, { signedIn: true }),
  PhotosPage: themed('photos', ROUTES.photos, PhotosPage, { signedIn: true }),
  PhotoAlbumPage: themed('photoAlbum', ROUTES.photos, PhotoAlbumPage, { signedIn: true, within: true }),
};

/** Swap point: the theme kit's recipes, with the placeholders as the fallback for unknown themes. */
export const recipes: PageRecipes = themedRecipes;

/** The public pages' recipes with no reader: what a prerendered copy renders. */
const anonymousRecipes = {
  StoryPage: themed('story', ROUTES.story, StoryPage, {}, 'anonymous'),
  AdventuresPage: themed('adventures', ROUTES.adventures, AdventuresPage, {}, 'anonymous'),
  AdventureDetailPage: themed('adventureDetail', ROUTES.adventures, AdventureDetailPage, { within: true }, 'anonymous'),
} satisfies Partial<PageRecipes>;

export const publicRecipes = (reader: Reader): typeof anonymousRecipes => (reader === 'anonymous' ? anonymousRecipes : recipes);

export type { AdventuresRecipeProps, AskRecipeProps };
