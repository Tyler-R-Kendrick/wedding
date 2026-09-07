import type { ContentRecipes } from '@/themes/content-types';
import { createGenericRecipes } from '@/themes/shared/recipes';
import type { ThemeRecipes } from '@/themes/types';
import { kit } from '../kit';
import { ConservatoryAdventureDetailPage } from './adventure-detail';
import { ConservatoryAdventuresPage } from './adventures';
import { ConservatoryAskPage } from './ask';
import { ConservatoryExploreCaaPage } from './explore-caa';
import { ConservatoryGiftsPage } from './gifts';
import { ConservatoryGuidePage } from './guide';
import { ConservatoryHomePage } from './home';
import { ConservatoryRecommendationPage } from './recommendation';
import { ConservatoryStoryPage } from './story';
import { ConservatoryTravelPage } from './travel';
import { ConservatoryVenueSpacePage } from './venue-space';
import { ConservatoryWeddingPage } from './wedding';

export const recipes: ThemeRecipes = {
  home: ConservatoryHomePage,
  ...createGenericRecipes(kit, { numbered: false, mounted: true }),
};

/** Level-05 content pages on the herbarium sheet: stems, pressed cards, kraft tags, jar labels, field notes. */
export const content: ContentRecipes = {
  story: ConservatoryStoryPage,
  adventures: ConservatoryAdventuresPage,
  adventureDetail: ConservatoryAdventureDetailPage,
  guide: ConservatoryGuidePage,
  recommendation: ConservatoryRecommendationPage,
  exploreCaa: ConservatoryExploreCaaPage,
  venueSpace: ConservatoryVenueSpacePage,
  wedding: ConservatoryWeddingPage,
  travel: ConservatoryTravelPage,
  gifts: ConservatoryGiftsPage,
  ask: ConservatoryAskPage,
};
