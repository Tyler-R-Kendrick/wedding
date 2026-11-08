import type { ServerEnv } from '@/lib/env';
import { GoogleSheetsGuestSheet } from './google-sheets';
import { MockGuestSheet } from './mock';
import type { GuestSheetProvider } from './types';
import { UnconfiguredGuestSheet } from './unconfigured';

export * from './types';
export { GoogleSheetsGuestSheet, type GoogleSheetsConfig } from './google-sheets';
export { MockGuestSheet, MOCK_GUEST_SHEET_VALUES } from './mock';
export { UnconfiguredGuestSheet } from './unconfigured';
export { parseGuestSheet } from './parse';

export type GuestSheetEnv = Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'GUEST_SHEET_ID' | 'GUEST_SHEET_RANGE' | 'GOOGLE_SERVICE_ACCOUNT_EMAIL' | 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY' | 'GUEST_SHEET_CACHE_SECONDS'> & { isProduction?: boolean };

const REQUIRED = ['GUEST_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'] as const;

/**
 * All three set -> the Google Sheets adapter. None set -> the mock in development and tests, and
 * "not connected" in production. Some set -> "not connected" everywhere, naming what is missing,
 * so a half-finished setup is visible instead of quietly showing sample rows.
 */
export function createGuestSheetProvider(env: GuestSheetEnv, deps: { fetch?: typeof fetch } = {}): GuestSheetProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockGuestSheet();
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length === 0) {
    return new GoogleSheetsGuestSheet(
      { sheetId: env.GUEST_SHEET_ID!, range: env.GUEST_SHEET_RANGE, clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!, cacheSeconds: env.GUEST_SHEET_CACHE_SECONDS },
      deps,
    );
  }
  if (missing.length < REQUIRED.length) return new UnconfiguredGuestSheet([...missing], 'the planning sheet is only partly configured');
  if (env.isProduction) return new UnconfiguredGuestSheet([...missing]);
  return new MockGuestSheet();
}
