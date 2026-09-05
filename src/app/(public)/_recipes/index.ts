import type { ComponentType } from 'react';
import { ConciergeSlot, type ConciergeSlotProps } from '@/components/concierge';
import type { AdventureDetailData } from '@/capabilities/show_adventure';
import type { ExploreCaaPageData } from '@/capabilities/get_venue_facts';
import type { StoryPageData } from '@/capabilities/get_story';
import type { VenueRoomData } from '@/capabilities/show_venue_room';
import type { RecommendationCard } from '@/domain/content/views';
import type { WeddingPageData } from '@/domain/venue/wedding-page';
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
  VenueSpacePage: ComponentType<{ data: VenueRoomData }>;
  WeddingPage: ComponentType<{ data: WeddingPageData }>;
  AskPage: ComponentType<AskRecipeProps>;
  /** The concierge island. A theme swaps the chrome here; the pipeline behind it never changes. */
  Concierge: ComponentType<ConciergeSlotProps>;
}

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
  Concierge: ConciergeSlot,
};

/** Swap point: `export const recipes = themeRecipes` once the theme kit lands. */
export const recipes: PageRecipes = placeholderRecipes;

export type { AdventuresRecipeProps, AskRecipeProps, ConciergeSlotProps, GuideRecipeProps };
