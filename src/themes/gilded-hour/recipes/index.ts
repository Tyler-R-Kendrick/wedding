import type { ContentRecipes } from '@/themes/content-types';
import { createGenericRecipes } from '@/themes/shared/recipes';
import type { ThemeRecipes } from '@/themes/types';
import { kit } from '../kit';
import { GildedAdventureDetailPage } from './adventure-detail';
import { GildedAdventuresPage } from './adventures';
import { GildedAskPage } from './ask';
import { GildedExploreCaaPage } from './explore-caa';
import { GildedGuidePage } from './guide';
import { GildedHomePage } from './home';
import { GildedRecommendationPage } from './recommendation';
import { GildedStoryPage } from './story';
import { GildedTravelPage } from './travel';
import { GildedVenueSpacePage } from './venue-space';
import { GildedWeddingPage } from './wedding';

export const recipes: ThemeRecipes = {
  home: GildedHomePage,
  ...createGenericRecipes(kit, { numbered: true, mounted: false }),
};

/** Level-05 content pages, one axis: title plaques, numbered acts, ledgers, the diptych, the floor plan. */
export const content: ContentRecipes = {
  story: GildedStoryPage,
  adventures: GildedAdventuresPage,
  adventureDetail: GildedAdventureDetailPage,
  guide: GildedGuidePage,
  recommendation: GildedRecommendationPage,
  exploreCaa: GildedExploreCaaPage,
  venueSpace: GildedVenueSpacePage,
  wedding: GildedWeddingPage,
  travel: GildedTravelPage,
  ask: GildedAskPage,
};
