import { REGION_VERSION } from './region.generated';

/**
 * world.svg's content hash (sha256, first 12 hex). scripts/generate-atlas.mjs does not write it, so
 * tests/unit/themes/atlas.test.ts recomputes it and fails when the file changes without this line.
 */
export const WORLD_VERSION = 'eb4c254d913f';

/**
 * The atlas files, addressed by content. next.config.ts serves /assets/atlas/ as immutable, so a
 * returning guest never re-downloads the map, and a regenerated map arrives under a new URL rather
 * than meeting code built for the old one.
 */
export const ATLAS_FILES = {
  world: `/assets/atlas/world.svg?v=${WORLD_VERSION}`,
  midwest: `/assets/atlas/midwest.svg?v=${REGION_VERSION}`,
} as const;
