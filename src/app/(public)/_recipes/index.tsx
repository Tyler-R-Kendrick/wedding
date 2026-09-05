import { headers } from 'next/headers';
import type { ComponentType, ReactNode } from 'react';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import type { ExploreCaaPageData } from '@/capabilities/get_venue_facts';
import type { StoryPageData } from '@/capabilities/get_story';
import type { VenueRoomData } from '@/capabilities/show_venue_room';
import type { RecommendationCard } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import type { WeddingPageData } from '@/domain/venue/wedding-page';
import { getPrincipal } from '@/lib/principal';
import { getTheme } from '@/themes';
import { selectContentRecipe, type ContentRecipeKey, type ContentRecipes } from '@/themes/content';
import { PREVIEW_HEADER } from '@/themes/routes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';
import type { PageFrame } from '@/themes/types';
import { AdventureDetailPage } from './AdventureDetailPage';
import { AdventuresPage, type AdventuresRecipeProps } from './AdventuresPage';
import { AskPage, type AskRecipeProps } from './AskPage';
import { ExploreCaaPage } from './ExploreCaaPage';
import { GuidePage, type GuideRecipeProps } from './GuidePage';
import { RecommendationPage } from './RecommendationPage';
import { StoryPage } from './StoryPage';
import { VenueSpacePage } from './VenueSpacePage';
import { WeddingPage } from './WeddingPage';

/**
 * The recipe seam. Pages fetch theme-agnostic data through capabilities and render
 * `recipes.<Page>`; Swarm B's integrator points this object at the theme kit's recipes
 * (`src/themes/<id>/recipes`) and nothing above this line needs to change.
 */
export interface PageRecipes {
  StoryPage: ComponentType<{ data: StoryPageData }>;
  AdventuresPage: ComponentType<AdventuresRecipeProps>;
  AdventureDetailPage: ComponentType<{ data: AdventureDetailData }>;
  GuidePage: ComponentType<GuideRecipeProps>;
  RecommendationPage: ComponentType<{ card: RecommendationCard }>;
  ExploreCaaPage: ComponentType<{ data: ExploreCaaPageData }>;
  VenueSpacePage: ComponentType<{ data: VenueSpaceData }>;
  WeddingPage: ComponentType<{ data: WeddingPageData }>;
  AskPage: ComponentType<AskRecipeProps>;
}
type VenueSpaceData = VenueRoomData;

export const placeholderRecipes: PageRecipes = {
  StoryPage,
  AdventuresPage,
  AdventureDetailPage,
  GuidePage,
  RecommendationPage,
  ExploreCaaPage,
  VenueSpacePage,
  WeddingPage,
  AskPage,
};

type PropsOf<K extends ContentRecipeKey> = Omit<Parameters<ContentRecipes[K]>[0], 'frame'>;

/**
 * Themed dispatch (level 05). Each page component resolves the active theme server-side from the
 * request (`?theme=` → cookie → default, already applied by the proxy), builds the page frame
 * (facts, lifecycle incl. an admin preview when the proxy forwarded one, nav for the current path,
 * switcher flag) and renders that theme's recipe. A theme without a recipe for the page falls back
 * to Swarm C's placeholder recipe, so unknown themes never break a route.
 */
function themed<K extends ContentRecipeKey>(key: K, currentPath: string, fallback: ComponentType<PropsOf<K>>): ComponentType<PropsOf<K>> {
  const Themed = async (props: PropsOf<K>): Promise<ReactNode> => {
    const theme = await getRequestTheme();
    const recipe = selectContentRecipe(getTheme(theme), key);
    if (!recipe) {
      const Fallback = fallback;
      return <Fallback {...props} />;
    }
    const h = await headers();
    const preview = h.get(PREVIEW_HEADER);
    const lifecycle = preview ? { principal: await getPrincipal(new Request('http://wedding.local/', { headers: h })), preview: { value: preview, source: 'query' as const } } : undefined;
    const frame = await buildPageFrame({ theme, currentPath, ...(lifecycle ? { lifecycle } : {}) });
    const render = recipe as unknown as (p: PropsOf<K> & { frame: PageFrame }) => ReactNode;
    return render({ ...props, frame });
  };
  Themed.displayName = `Themed(${key})`;
  return Themed;
}

export const themedRecipes: PageRecipes = {
  StoryPage: themed('story', ROUTES.story, StoryPage),
  AdventuresPage: themed('adventures', ROUTES.adventures, AdventuresPage),
  AdventureDetailPage: themed('adventureDetail', ROUTES.adventures, AdventureDetailPage),
  GuidePage: themed('guide', ROUTES.share, GuidePage),
  RecommendationPage: themed('recommendation', ROUTES.share, RecommendationPage),
  ExploreCaaPage: themed('exploreCaa', ROUTES.exploreCaa, ExploreCaaPage),
  VenueSpacePage: themed('venueSpace', ROUTES.exploreCaa, VenueSpacePage),
  WeddingPage: themed('wedding', ROUTES.wedding, WeddingPage),
  AskPage: themed('ask', ROUTES.ask, AskPage),
};

/** Swap point: the theme kit's recipes, with the placeholders as the fallback for unknown themes. */
export const recipes: PageRecipes = themedRecipes;

export type { AdventuresRecipeProps, AskRecipeProps, GuideRecipeProps };
