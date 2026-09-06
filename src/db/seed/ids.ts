import { ID_PATTERN } from '@/contracts/ids';

const CROCKFORD = /[^0-9A-HJKMNP-TV-Z]/g;

/**
 * Deterministic, ULID-shaped ids for seed rows and test fixtures so the same row is
 * upserted on every boot and tests can reference it. `prefix` distinguishes real seed
 * data ('01SD') from test-only fixtures ('01E2E').
 */
export function deterministicId<T extends string = string>(prefix: '01SD' | '01E2E', tag: string): T {
  const clean = tag.toUpperCase().replace(CROCKFORD, '');
  const body = (prefix + clean).slice(0, 26).padEnd(26, '0');
  if (!ID_PATTERN.test(body)) throw new Error(`deterministic id is not ULID-shaped: ${body}`);
  return body as T;
}

export const seedId = <T extends string = string>(tag: string): T => deterministicId<T>('01SD', tag);
export const fixtureId = <T extends string = string>(tag: string): T => deterministicId<T>('01E2E', tag);
