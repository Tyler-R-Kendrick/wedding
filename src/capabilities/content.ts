import type { AnyCapability } from '@/contracts/capability';
import { findAdventures } from './find_adventures';
import { getStory } from './get_story';
import { getVenueFacts } from './get_venue_facts';
import { listAdventures } from './list_adventures';
import { listItineraries } from './list_itineraries';
import { markContentVerified } from './mark_content_verified';
import { saveContentRecord } from './save_content_record';
import { searchWeddingInformationStatic } from './search_wedding_information_static';
import { showAdventure } from './show_adventure';
import { showVenueRoom } from './show_venue_room';

/**
 * Story, adventures, recommendations, CAA docent, static search, and the admin content
 * editors (swarm C). Registered from src/capabilities/index.ts with one line.
 */
export const contentCapabilities: readonly AnyCapability[] = [
  getStory,
  listAdventures,
  showAdventure,
  findAdventures,
  listItineraries,
  showVenueRoom,
  getVenueFacts,
  searchWeddingInformationStatic,
  saveContentRecord,
  markContentVerified,
];

export { getStory, listAdventures, showAdventure, findAdventures, listItineraries, showVenueRoom, getVenueFacts, searchWeddingInformationStatic, saveContentRecord, markContentVerified };
