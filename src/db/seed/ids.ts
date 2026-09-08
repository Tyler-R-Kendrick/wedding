import { ID_PATTERN } from '@/contracts/ids';

const CROCKFORD = /[^0-9A-HJKMNP-TV-Z]/g;

/**
 * Every id this module has issued, and the tag that asked for it.
 *
 * `padEnd(26, '0')` makes a tag ambiguous with itself plus zeros, and the two ids then differ in
 * nothing: `fixtureId('ENT1')` and `fixtureId('ENT10')` are the same 26 characters. The seeder
 * inserts with `onConflictDoNothing`, so the second row was dropped in silence and every review,
 * fixture read and e2e assertion about it ran against a hole — a green suite over missing data.
 * A collision is a bug in the caller's tags, not something to paper over, so it throws where it
 * happens and names both tags.
 */
const ISSUED = new Map<string, string>();

/**
 * Deterministic, ULID-shaped ids for seed rows and test fixtures so the same row is
 * upserted on every boot and tests can reference it. `prefix` distinguishes real seed
 * data ('01SD') from test-only fixtures ('01E2E').
 */
export function deterministicId<T extends string = string>(prefix: '01SD' | '01E2E', tag: string): T {
  const clean = tag.toUpperCase().replace(CROCKFORD, '');
  const body = (prefix + clean).slice(0, 26).padEnd(26, '0');
  if (!ID_PATTERN.test(body)) throw new Error(`deterministic id is not ULID-shaped: ${body}`);
  // Keyed on the CLEANED tag, not the raw one: case and punctuation are normalised away on purpose
  // ("gsta1" and "GSTA1" are the same fixture and `publication.test.ts` pins that), so comparing raw
  // tags would report a collision between a tag and itself.
  const claimed = ISSUED.get(body);
  if (claimed !== undefined && claimed !== clean) {
    throw new Error(
      `deterministic id collision: "${clean}" and "${claimed}" both produce ${body}. ` +
        'Padding with "0" makes a tag indistinguishable from itself plus zeros — "ENT1" and "ENT10" ' +
        'are the same id — so give the two tags the same width (ENT01, ENT10) or make them distinct ' +
        'some other way. Every character Crockford base32 allows can also appear in a tag, so there ' +
        'is no filler that would separate them; this check is the separation.',
    );
  }
  ISSUED.set(body, clean);
  return body as T;
}

export const seedId = <T extends string = string>(tag: string): T => deterministicId<T>('01SD', tag);
export const fixtureId = <T extends string = string>(tag: string): T => deterministicId<T>('01E2E', tag);
