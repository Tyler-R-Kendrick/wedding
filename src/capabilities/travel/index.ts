import type { AnyCapability } from '@/contracts/capability';
import { addTripItemCapability } from './add_trip_item';
import { adminGetTravelConfig } from './admin_get_travel_config';
import { adminRemoveHotel } from './admin_remove_hotel';
import { adminRemoveTravelLink } from './admin_remove_travel_link';
import { adminSaveHotel } from './admin_save_hotel';
import { adminSaveTravelLink } from './admin_save_travel_link';
import { deleteMyTravelProfile } from './delete_my_travel_profile';
import { getMyTravelProfile } from './get_my_travel_profile';
import { getMyTrip } from './get_my_trip';
import { listHotelRecommendations } from './list_hotel_recommendations';
import { openBookingLink } from './open_booking_link';
import { removeTripItemCapability } from './remove_trip_item';
import { searchTravelOptions } from './search_travel_options';
import { updateMyTravelProfile } from './update_my_travel_profile';
import { updateTripItemCapability } from './update_trip_item';

/** Level 08 (Swarm F): travel profile, flights/hotels search, curated stays, booking hand-offs, trip bridge, admin config. */
export const travelCapabilities: readonly AnyCapability[] = [
  getMyTravelProfile,
  updateMyTravelProfile,
  deleteMyTravelProfile,
  searchTravelOptions,
  listHotelRecommendations,
  openBookingLink,
  addTripItemCapability,
  updateTripItemCapability,
  removeTripItemCapability,
  getMyTrip,
  adminGetTravelConfig,
  adminSaveHotel,
  adminRemoveHotel,
  adminSaveTravelLink,
  adminRemoveTravelLink,
];

export {
  getMyTravelProfile,
  updateMyTravelProfile,
  deleteMyTravelProfile,
  searchTravelOptions,
  listHotelRecommendations,
  openBookingLink,
  addTripItemCapability,
  updateTripItemCapability,
  removeTripItemCapability,
  getMyTrip,
  adminGetTravelConfig,
  adminSaveHotel,
  adminRemoveHotel,
  adminSaveTravelLink,
  adminRemoveTravelLink,
};
