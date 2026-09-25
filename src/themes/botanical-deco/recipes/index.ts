import type { ContentRecipes } from '@/themes/content-types';
import { createGenericRecipes } from '@/themes/shared/recipes';
import type { ThemeRecipes } from '@/themes/types';
import { kit } from '../kit';
import { BotanicalAdventureDetailPage } from './adventure-detail';
import { BotanicalAdventuresPage } from './adventures';
import { BotanicalAskPage } from './ask';
import { BotanicalOurVenuePage } from './our-venue';
import { BotanicalGiftsPage } from './gifts';
import { BotanicalPhotoAlbumPage, BotanicalPhotosPage } from './photos';
import { BotanicalGuidePage } from './guide';
import { BotanicalHomePage } from './home';
import { BotanicalRecommendationPage } from './recommendation';
import { BotanicalStoryPage } from './story';
import { BotanicalTravelPage } from './travel';
import { BotanicalVenueSpacePage } from './venue-space';
import { BotanicalWeddingPage } from './wedding';

export const recipes: ThemeRecipes = {
  home: BotanicalHomePage,
  ...createGenericRecipes(kit, { numbered: true, mounted: false }),
};

/** Level-05 content pages, one axis: title plaques, numbered acts, ledgers, the diptych, the floor plan. */
export const content: ContentRecipes = {
  story: BotanicalStoryPage,
  adventures: BotanicalAdventuresPage,
  adventureDetail: BotanicalAdventureDetailPage,
  guide: BotanicalGuidePage,
  recommendation: BotanicalRecommendationPage,
  ourVenue: BotanicalOurVenuePage,
  venueSpace: BotanicalVenueSpacePage,
  wedding: BotanicalWeddingPage,
  travel: BotanicalTravelPage,
  gifts: BotanicalGiftsPage,
  photos: BotanicalPhotosPage,
  photoAlbum: BotanicalPhotoAlbumPage,
  ask: BotanicalAskPage,
};
