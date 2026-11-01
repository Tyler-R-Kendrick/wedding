/** Owner-confirmed room-block copy (Sara Travel & Accommodations email, Tyler confirmed). */

import type { RoomBlock } from '@/db/schema/travel';

export const CAA_STAY_INTRO =
  "We've reserved a block of rooms at Chicago Athletic Association for our wedding guests. We recommend booking early, as rooms in our block are limited.";

export const CAA_UPGRADES_COPY =
  "Looking for an upgraded room or an extended stay? Let us know, and we'll connect you with the hotel to explore available options.";

export const CAA_BOOKING_LINK_LABEL = 'Fitzgerald - Kendrick Wedding Room Block Booking Link';

export const CAA_BOOKING_URL = 'https://www.hyatt.com/events/en-US/group-booking/CHIUB/G-FIKE';

export const CAA_GROUP_CODE = 'G-FIKE';

export const CAA_BOOKING_PHONE = '844-312-2221';

export const CAA_BOOKING_PHONE_REFERENCE = 'Fitzgerald - Kendrick Wedding Room Block';

/** Block covers the night before the wedding and the wedding night (check-out Sunday). */
export const CAA_BLOCK_CHECK_IN = '2027-07-16';
export const CAA_BLOCK_CHECK_OUT = '2027-07-18';

export const CAA_BLOCK_NIGHTS_LABEL = 'Nights of Friday, July 16 and Saturday, July 17, 2027';

export const CAA_PARKING_ARRIVAL_COPY =
  'Hotel valet 24 hours at 71 E. Madison St, $84 per vehicle, per night, with unlimited in-and-out privileges. Nearby self-park: Millennium Park Garage (6 S. Columbus Dr) and Millennium Lakeside Garage (5 S. Columbus Dr).';

/** Guest-facing sentence stored on the room-block record for concierge and WebMCP. */
export function caaPhoneBookingSentence(): string {
  return `Call ${CAA_BOOKING_PHONE} and reference "${CAA_BOOKING_PHONE_REFERENCE}" (group code ${CAA_GROUP_CODE}).`;
}

/** Guest-facing Block dates line for the confirmed CAA block. */
export function venueBlockDatesLabel(
  block: Pick<RoomBlock, 'checkIn' | 'checkOut' | 'placeholder'> | null | undefined,
): string | null {
  if (!block || block.placeholder || !block.checkIn || !block.checkOut) return null;
  if (block.checkIn === CAA_BLOCK_CHECK_IN && block.checkOut === CAA_BLOCK_CHECK_OUT) return CAA_BLOCK_NIGHTS_LABEL;
  return null;
}
