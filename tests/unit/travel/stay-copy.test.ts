import { describe, expect, it } from 'vitest';
import {
  CAA_BLOCK_CHECK_IN,
  CAA_BLOCK_CHECK_OUT,
  CAA_BLOCK_NIGHTS_LABEL,
  venueBlockDatesLabel,
} from '@/domain/travel/stay-copy';

describe('venueBlockDatesLabel', () => {
  it('returns the owner-confirmed nights line for the CAA block', () => {
    expect(
      venueBlockDatesLabel({
        checkIn: CAA_BLOCK_CHECK_IN,
        checkOut: CAA_BLOCK_CHECK_OUT,
        placeholder: false,
      }),
    ).toBe(CAA_BLOCK_NIGHTS_LABEL);
  });

  it('returns null for placeholders or missing dates', () => {
    expect(venueBlockDatesLabel(null)).toBeNull();
    expect(venueBlockDatesLabel({ checkIn: null, checkOut: null, placeholder: true })).toBeNull();
  });
});
