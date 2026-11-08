import { ok } from '@/contracts/result';
import { okConfig, upHealth } from '../base';
import { parseGuestSheet } from './parse';
import type { GuestSheetProvider, GuestSheetSnapshot } from './types';

/**
 * Development and tests only: a few obviously fake lines in the sheet's real column layout, so the
 * console section renders without Google. Production never gets this (see `index.ts`).
 */
export const MOCK_GUEST_SHEET_VALUES: string[][] = [
  ['Family/Group Names', 'Total Adults', 'Total Kids', 'Plus 1', 'Guest Of', 'Group', 'Priority', 'Address', 'Email', 'Phone', 'Save the Date Sent', 'Invite Sent', 'RSVP', 'Table Number', 'Menu Choice', 'Dietary Restrictions', 'Notes'],
  ['Sample household A', '2', '', '', 'Bride', 'Immediate Family', '1'],
  ['Sample household B', '2', '1', '', 'Groom', 'Extended Family', '2', '', '', '', 'Yes'],
  ['Sample household C', '1', '', '1', 'Both', 'Friend', '3'],
  [],
  ['', '', '', '', '', '', '', 'Total', '5', '1', '1'],
];

export class MockGuestSheet implements GuestSheetProvider {
  readonly kind = 'guest-sheet' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { read: true };
  readonly sheetUrl = null;
  constructor(private readonly values: string[][] = MOCK_GUEST_SHEET_VALUES) {}
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async read() {
    const snapshot: GuestSheetSnapshot = { provider: this.name, retrievedAt: new Date().toISOString(), ttlSeconds: 0, data: { ...parseGuestSheet(this.values), stale: false, sample: true } };
    return ok(snapshot);
  }
}
